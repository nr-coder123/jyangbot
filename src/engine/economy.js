'use strict';
/** Inventory, Nyang, shop, player trades and the player market. */
const { r2, fmt, num, newId, UserError } = require('../utils');

const qtyOf = (c, itemId) => Number(c.inventory[itemId]) || 0;

function addItem(c, itemId, qty) {
  const v = qtyOf(c, itemId) + Number(qty);
  if (v > 0) c.inventory[itemId] = v;
  else delete c.inventory[itemId];
}

function removeItem(state, c, itemId, qty) {
  if (qtyOf(c, itemId) < qty) {
    const it = state.items.find((i) => i.id === itemId);
    throw new UserError(`**${c.name}** doesn't have ${qty}× ${it ? it.name : 'that item'} (has ${qtyOf(c, itemId)}).`);
  }
  addItem(c, itemId, -qty);
}

function addNyang(c, amount) {
  c.nyang = r2(Math.max(0, c.nyang + Number(amount)));
}

function spendNyang(state, c, amount) {
  if (c.nyang < amount) throw new UserError(`Not enough ${state.settings.currencyName}: need **${fmt(amount)}**, ${c.name} has **${fmt(c.nyang)}**.`);
  c.nyang = r2(c.nyang - amount);
}

function positiveInt(n, label = 'Quantity') {
  n = Math.floor(Number(n));
  if (!(n > 0)) throw new UserError(`${label} must be at least 1.`);
  return n;
}

// ---------- Shop ----------
const shopItems = (state) => state.items.filter((i) => i.shop?.enabled);

const W_ECON = () => require('../world/economy');
const worldOn = (state) => !!state.world?.settings?.enabled;
/** Raw materials (trade goods) belong to the world economy: players can't trade, list or sell them. */
const isRaw = (item) => !!item?.tradeGood;
/** What the shop pays for one item (0 = it doesn't buy it). With the World on it follows the economy (see world/economy itemQuote). */
function shopSellPrice(state, item) {
  if (isRaw(item)) return 0;
  if (worldOn(state)) return W_ECON().itemQuote(state, item, null).sellback;
  if (item.sellPrice !== null && item.sellPrice !== undefined) return num(item.sellPrice);
  if (item.shop?.enabled && item.shop.price > 0) return Math.floor((item.shop.price * num(state.settings.shopSellbackPercent)) / 100);
  return 0;
}
/** Highest price an item may be resold for on the player market (Infinity when the World is off). */
function resaleCap(state, item) {
  if (!worldOn(state)) return Infinity;
  return W_ECON().itemQuote(state, item, null).resaleCap;
}

function buyFromShop(state, c, item, qty, unitPrice = null) {
  qty = positiveInt(qty);
  if (!item.shop?.enabled) throw new UserError(`**${item.name}** is not sold in the shop.`);
  const stock = num(item.shop.stock, -1);
  if (stock >= 0 && stock < qty) throw new UserError(`Only ${stock} left in stock.`);
  // unitPrice: the regional price (items linked to a trade good move with it, within World settings → max swing).
  const cost = r2(num(unitPrice ?? item.shop.price) * qty);
  spendNyang(state, c, cost);
  if (stock >= 0) item.shop.stock = stock - qty;
  addItem(c, item.id, qty);
  return { cost, qty };
}

function sellToShop(state, c, item, qty) {
  qty = positiveInt(qty);
  const price = shopSellPrice(state, item);
  if (isRaw(item)) throw new UserError(`**${item.name}** is a raw material: it belongs to the world's economy and can't be sold.`);
  if (!(price > 0)) throw new UserError(`The shop doesn't buy **${item.name}**. Try the player market (\`/market list\`).`);
  removeItem(state, c, item.id, qty);
  const total = r2(price * qty);
  addNyang(c, total);
  return { total, price, qty };
}

// ---------- Trades ----------
function validateSide(state, c, side, label, other) {
  if (side.itemId) {
    const it = state.items.find((i) => i.id === side.itemId);
    if (!it) throw new UserError(`${label}: item no longer exists.`);
    if (!it.tradeable || isRaw(it)) throw new UserError(isRaw(it) ? `**${it.name}** is a raw material: it belongs to the world's economy and can't change hands.` : `**${it.name}** cannot be traded.`);
    if (qtyOf(c, side.itemId) < side.qty) throw new UserError(`${label}: **${c.name}** doesn't have ${side.qty}× ${it.name}.`);
  }
  if (side.nyang > 0 && c.nyang < side.nyang) throw new UserError(`${label}: **${c.name}** doesn't have ${fmt(side.nyang)} ${state.settings.currencyName}.`);
}

function createTrade(state, from, to, give, want) {
  if (from.id === to.id || from.ownerId === to.ownerId) throw new UserError("You can't trade with yourself.");
  const clean = (s) => ({ itemId: s.itemId || null, qty: s.itemId ? positiveInt(s.qty || 1) : 0, nyang: Math.max(0, r2(s.nyang || 0)) });
  give = clean(give);
  want = clean(want);
  if (!give.itemId && !give.nyang && !want.itemId && !want.nyang) throw new UserError('A trade needs at least one item or some Nyang.');
  validateSide(state, from, give, 'Your offer', to);
  const t = {
    id: newId('T'),
    fromCharId: from.id, fromUserId: from.ownerId,
    toCharId: to.id, toUserId: to.ownerId,
    give, want,
    status: 'pending',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + num(state.settings.tradeExpiryMinutes, 15) * 60000).toISOString(),
  };
  state.trades.unshift(t);
  if (state.trades.length > 500) state.trades.length = 500;
  return t;
}

function settleTrade(state, t) {
  if (t.status !== 'pending') throw new UserError(`This trade is already ${t.status}.`);
  if (Date.parse(t.expiresAt) < Date.now()) {
    t.status = 'expired';
    throw new UserError('This trade has expired.');
  }
  const from = state.characters.find((c) => c.id === t.fromCharId);
  const to = state.characters.find((c) => c.id === t.toCharId);
  if (!from || !to) throw new UserError('One of the characters no longer exists.');
  validateSide(state, from, t.give, 'Offer', to);
  validateSide(state, to, t.want, 'Request', from);
  if (t.give.itemId) { addItem(from, t.give.itemId, -t.give.qty); addItem(to, t.give.itemId, t.give.qty); }
  if (t.give.nyang) { addNyang(from, -t.give.nyang); addNyang(to, t.give.nyang); }
  if (t.want.itemId) { addItem(to, t.want.itemId, -t.want.qty); addItem(from, t.want.itemId, t.want.qty); }
  if (t.want.nyang) { addNyang(to, -t.want.nyang); addNyang(from, t.want.nyang); }
  t.status = 'accepted';
  t.settledAt = new Date().toISOString();
  return { from, to };
}

function describeSide(state, side) {
  const parts = [];
  if (side.itemId) {
    const it = state.items.find((i) => i.id === side.itemId);
    parts.push(`${side.qty}× **${it ? it.name : '?'}**`);
  }
  if (side.nyang) parts.push(`**${fmt(side.nyang)}** ${state.settings.currencyName}`);
  return parts.join(' + ') || '*nothing*';
}

// ---------- Player market ----------
function listOnMarket(state, c, item, qty, price) {
  qty = positiveInt(qty);
  price = r2(price);
  if (!(price > 0)) throw new UserError('Price must be above 0.');
  if (isRaw(item)) throw new UserError(`**${item.name}** is a raw material: it belongs to the world's economy and can't be sold.`);
  if (!item.tradeable || item.marketable === false) throw new UserError(`**${item.name}** can't be sold on the player market.`);
  // Nobody can resell for more than the cheapest honest source (see world/economy itemQuote): the price is corrected down.
  const cap = resaleCap(state, item);
  const asked = price;
  if (price > cap) price = r2(cap);
  removeItem(state, c, item.id, qty); // escrow
  const l = { id: newId('L').slice(0, 7).toUpperCase(), sellerCharId: c.id, sellerUserId: c.ownerId, itemId: item.id, qty, price, createdAt: new Date().toISOString() };
  state.market.unshift(l);
  if (asked > price) l.corrected = asked;
  return l;
}

function buyFromMarket(state, buyer, listing, qty) {
  qty = positiveInt(qty);
  if (listing.sellerCharId === buyer.id || listing.sellerUserId === buyer.ownerId) throw new UserError("You can't buy your own listing — use `/market cancel`.");
  if (qty > listing.qty) throw new UserError(`Only ${listing.qty} available in that listing.`);
  const item = state.items.find((i) => i.id === listing.itemId);
  if (item) { const cap = resaleCap(state, item); if (listing.price > cap) listing.price = r2(cap); }
  const cost = r2(listing.price * qty);
  spendNyang(state, buyer, cost);
  const seller = state.characters.find((c) => c.id === listing.sellerCharId);
  const fee = r2((cost * num(state.settings.marketFeePercent)) / 100);
  if (seller) addNyang(seller, cost - fee);
  addItem(buyer, listing.itemId, qty);
  listing.qty -= qty;
  if (listing.qty <= 0) state.market = state.market.filter((l) => l !== listing);
  return { cost, fee, seller };
}

function cancelListing(state, listing) {
  const seller = state.characters.find((c) => c.id === listing.sellerCharId);
  if (seller) addItem(seller, listing.itemId, listing.qty);
  state.market = state.market.filter((l) => l !== listing);
  return seller;
}

module.exports = {
  qtyOf, addItem, removeItem, addNyang, spendNyang, positiveInt, shopItems, shopSellPrice, resaleCap, isRaw, buyFromShop, sellToShop,
  createTrade, settleTrade, describeSide, listOnMarket, buyFromMarket, cancelListing,
};
