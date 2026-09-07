// 云函数 equipment
// 器材共享：支持出租（rent）/ 出售（sell）两种交易模式 + 需求（demand）发布
// 集合：
//   equipment             器材信息（tradeType: rent / sell）
//   equipment_order       租借订单（保留兼容）
//   equipment_buy_order   购买订单
//   equipment_demand      需求/求租/求购
//  type:
//    器材：
//    'publish'      发布器材（rent / sell）
//    'list'         列表浏览（可按 tradeType 过滤）
//    'detail'       器材详情
//    'borrow'       发起租借（仅 rent）
//    'cancel'       取消租借
//    'myBorrows'    我的租借（我借的）
//    'myPublished'  我发布的器材
//    'buy'          发起购买（仅 sell）
//    'cancelBuy'    取消购买
//    'myBuys'       我买到的
//    需求：
//    'publishDemand' 发布需求
//    'listDemands'   需求列表
//    'closeDemand'   关闭需求
//    'myDemands'     我发布的需求

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const EQUIP = 'equipment';
const ORDER = 'equipment_order';         // 租借订单
const BUY_ORDER = 'equipment_buy_order'; // 购买订单
const DEMAND = 'equipment_demand';       // 需求/求租/求购

const ok = (data = null) => ({ success: true, data });
const fail = (errCode, errMsg) => ({ success: false, errCode, errMsg });
const getOpenId = () => cloud.getWXContext().OPENID || '';

// ============ 工具：确保集合存在 ============
// 微信云开发不会自动建集合，第一次操作前要显式 createCollection
// 否则会抛 -502005 "Db or Table not exist"；已存在会被忽略
// 兜底：任何其他错误都吞掉 + 打日志，不让 ensureCollection 自身把云函数打死
const ensureCollection = async (name) => {
  try {
    await db.createCollection(name);
    console.log(`[equipment] 已自动创建集合 ${name}`);
  } catch (e) {
    const msg = (e && (e.errMsg || e.message)) || '';
    if (e && (e.errCode === -501001 || /already exist/i.test(msg))) {
      return; // 集合已存在，正常
    }
    // 其他错误（权限、API 不可用等）只记日志，不抛
    // 后续 db.collection(name).get() 会以 -502005 暴露真正的问题
    console.error(`[equipment] ensureCollection(${name}) 失败（忽略，继续）:`, msg);
  }
};

// ============ 工具：转义正则特殊字符 ============
// 关键：用户输入的关键词直接当正则会报错（含 . * ( 等），先转义
const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ============ 发布器材 ============
// payload: { name, category, tradeType, pricePerDay, deposit, salePrice, condition, description, coverUrl, contact, nickName }
const publish = async (event) => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '请先登录');
  const p = event.payload || {};
  if (!p.name) return fail('INVALID_PARAM', '器材名称必填');
  if (!p.category) return fail('INVALID_PARAM', '请选择分类');

  // 交易类型：rent 出租 / sell 出售，默认 rent
  const tradeType = p.tradeType === 'sell' ? 'sell' : 'rent';

  // 根据交易类型校验价格字段
  if (tradeType === 'rent') {
    if (p.pricePerDay === '' || p.pricePerDay === undefined || p.pricePerDay === null || isNaN(p.pricePerDay)) {
      return fail('INVALID_PARAM', '请填写日租金');
    }
    if (p.deposit === '' || p.deposit === undefined || p.deposit === null || isNaN(p.deposit)) {
      return fail('INVALID_PARAM', '请填写押金');
    }
  } else {
    if (p.salePrice === '' || p.salePrice === undefined || p.salePrice === null || isNaN(p.salePrice)) {
      return fail('INVALID_PARAM', '请填写出售价格');
    }
  }

  try {
    await ensureCollection(EQUIP);
    const now = Date.now();
    const data = {
      name: String(p.name).slice(0, 50),
      category: p.category,           // racket / ball / shoe / other
      tradeType: tradeType,           // rent / sell
      condition: String(p.condition || '九成新').slice(0, 100),
      description: String(p.description || '').slice(0, 200),
      coverUrl: String(p.coverUrl || ''),
      contact: String(p.contact || '').slice(0, 50),
      status: 'available',            // available / rented / sold / offline
      nickName: String(p.nickName || '拾球记用户').slice(0, 30),
      createdAt: now
    };

    if (tradeType === 'rent') {
      data.pricePerDay = Number(p.pricePerDay) || 0;
      data.deposit = Number(p.deposit) || 0;
    } else {
      data.salePrice = Number(p.salePrice) || 0;
      data.originalPrice = p.originalPrice && !isNaN(p.originalPrice) ? Number(p.originalPrice) : 0;
    }

    const res = await db.collection(EQUIP).add({ data });
    return ok({ _id: res._id, tradeType });
  } catch (e) {
    console.error('[equipment] publish error', e);
    return fail('DB_ERROR', e.message || '发布失败');
  }
};

// ============ 列表 ============
// 可选参数 tradeType: 'rent' | 'sell' | undefined（全部）
// 可选参数 keyword: 模糊匹配 name / description / category
const list = async (event) => {
  await ensureCollection(EQUIP);
  const { tradeType, keyword } = event || {};
  const where = {};
  if (tradeType === 'rent' || tradeType === 'sell') {
    where.tradeType = tradeType;
  }
  if (keyword && String(keyword).trim()) {
    const kw = String(keyword).trim();
    // 关键：微信云开发 RegExp 用法，options:'i' 忽略大小写
    const re = db.RegExp({ regexp: escapeRegExp(kw), options: 'i' });
    where.$or = [
      { name: re },
      { description: re },
      { category: re },
      { condition: re }
    ];
  }
  const res = await db.collection(EQUIP)
    .where(where)
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();
  return ok({ list: res.data });
};

// ============ 详情 ============
const detail = async (event) => {
  const { id } = event;
  if (!id) return fail('INVALID_PARAM', 'id 必填');
  await ensureCollection(EQUIP);
  const res = await db.collection(EQUIP).doc(id).get();
  return ok(res.data);
};

// ============ 发起租借 ============
const borrow = async (event) => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '请先登录');
  const p = event.payload || {};
  if (!p.equipId) return fail('INVALID_PARAM', 'equipId 必填');
  if (!p.days || p.days < 1) return fail('INVALID_PARAM', '租借天数至少 1');

  try {
    await ensureCollection(EQUIP);
    await ensureCollection(ORDER);
    const eq = await db.collection(EQUIP).doc(p.equipId).get();
    if (!eq.data) return fail('NOT_FOUND', '器材不存在');
    if (eq.data._openid === openid) return fail('OWN_ITEM', '不能租借自己发布的器材');
    if (eq.data.tradeType === 'sell') return fail('NOT_RENTABLE', '该器材为出售，不可租借');
    if (eq.data.status !== 'available') return fail('UNAVAILABLE', '该器材当前不可租借');

    const now = Date.now();
    const res = await db.collection(ORDER).add({
      data: {
        equipId: p.equipId,
        equipName: eq.data.name,
        equipCover: eq.data.coverUrl,
        days: Number(p.days),
        rentFee: Number(p.days) * (eq.data.pricePerDay || 0),
        deposit: eq.data.deposit || 0,
        contact: String(p.contact || '').slice(0, 50),
        remark: String(p.remark || '').slice(0, 200),
        status: 'pending',         // pending / confirmed / returned / cancelled
        nickName: String(p.nickName || '拾球记用户').slice(0, 30),
        createdAt: now,
        updatedAt: now
      }
    });
    return ok({ _id: res._id });
  } catch (e) {
    console.error('[equipment] borrow error', e);
    return fail('DB_ERROR', e.message || '租借失败');
  }
};

// ============ 取消租借 ============
const cancel = async (event) => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '请先登录');
  const { id } = event;
  if (!id) return fail('INVALID_PARAM', 'id 必填');
  try {
    await ensureCollection(ORDER);
    const cur = await db.collection(ORDER).doc(id).get();
    if (!cur.data) return fail('NOT_FOUND', '订单不存在');
    if (cur.data._openid !== openid) return fail('FORBIDDEN', '只能取消自己的订单');
    if (cur.data.status === 'cancelled') return fail('STATE', '订单已取消');
    await db.collection(ORDER).doc(id).update({
      data: { status: 'cancelled', updatedAt: Date.now() }
    });
    return ok({ id });
  } catch (e) {
    return fail('DB_ERROR', e.message || '取消失败');
  }
};

// ============ 发起购买 ============
// payload: { equipId, address, phone, remark, nickName }
const buy = async (event) => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '请先登录');
  const p = event.payload || {};
  if (!p.equipId) return fail('INVALID_PARAM', 'equipId 必填');
  if (!p.address) return fail('INVALID_PARAM', '请填写收货地址');
  if (!p.phone) return fail('INVALID_PARAM', '请填写联系电话');

  try {
    await ensureCollection(EQUIP);
    await ensureCollection(BUY_ORDER);
    const eq = await db.collection(EQUIP).doc(p.equipId).get();
    if (!eq.data) return fail('NOT_FOUND', '器材不存在');
    if (eq.data._openid === openid) return fail('OWN_ITEM', '不能购买自己发布的器材');
    if (eq.data.tradeType !== 'sell') return fail('NOT_FOR_SALE', '该器材仅可租借');
    if (eq.data.status !== 'available') return fail('UNAVAILABLE', '该器材已被购买或下架');

    const now = Date.now();
    const res = await db.collection(BUY_ORDER).add({
      data: {
        equipId: p.equipId,
        equipName: eq.data.name,
        equipCover: eq.data.coverUrl,
        price: Number(eq.data.salePrice) || 0,
        address: String(p.address).slice(0, 100),
        phone: String(p.phone).slice(0, 20),
        remark: String(p.remark || '').slice(0, 200),
        contact: String(p.contact || '').slice(0, 50),
        status: 'pending',         // pending / confirmed / completed / cancelled
        nickName: String(p.nickName || '拾球记用户').slice(0, 30),
        createdAt: now,
        updatedAt: now
      }
    });
    return ok({ _id: res._id });
  } catch (e) {
    console.error('[equipment] buy error', e);
    return fail('DB_ERROR', e.message || '购买失败');
  }
};

// ============ 取消购买 ============
const cancelBuy = async (event) => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '请先登录');
  const { id } = event;
  if (!id) return fail('INVALID_PARAM', 'id 必填');
  try {
    await ensureCollection(BUY_ORDER);
    const cur = await db.collection(BUY_ORDER).doc(id).get();
    if (!cur.data) return fail('NOT_FOUND', '订单不存在');
    if (cur.data._openid !== openid) return fail('FORBIDDEN', '只能取消自己的订单');
    if (cur.data.status === 'cancelled') return fail('STATE', '订单已取消');
    await db.collection(BUY_ORDER).doc(id).update({
      data: { status: 'cancelled', updatedAt: Date.now() }
    });
    return ok({ id });
  } catch (e) {
    return fail('DB_ERROR', e.message || '取消失败');
  }
};

// ============ 我借的 ============
const myBorrows = async () => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '请先登录');
  await ensureCollection(ORDER);
  const res = await db.collection(ORDER)
    .where({ _openid: openid })
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();
  return ok({ list: res.data });
};

// ============ 我买的 ============
const myBuys = async () => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '请先登录');
  await ensureCollection(BUY_ORDER);
  const res = await db.collection(BUY_ORDER)
    .where({ _openid: openid })
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();
  return ok({ list: res.data });
};

// ============ 我发布的器材 ============
const myPublished = async () => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '请先登录');
  await ensureCollection(EQUIP);
  const res = await db.collection(EQUIP)
    .where({ _openid: openid })
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();
  return ok({ list: res.data });
};

// ============ 发布需求 ============
// payload: { name, category, demandType, expectedPrice, description, contact, nickName }
// demandType: 'rent' 求租 / 'sell' 求购
const publishDemand = async (event) => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '请先登录');
  const p = event.payload || {};
  if (!p.name) return fail('INVALID_PARAM', '请填写想要的器材名称');
  if (!p.category) return fail('INVALID_PARAM', '请选择分类');
  const demandType = p.demandType === 'sell' ? 'sell' : 'rent';

  try {
    await ensureCollection(DEMAND);
    const now = Date.now();
    const res = await db.collection(DEMAND).add({
      data: {
        name: String(p.name).slice(0, 50),
        category: p.category,           // racket / ball / shoe / other
        demandType: demandType,         // rent / sell
        expectedPrice: p.expectedPrice && !isNaN(p.expectedPrice) ? Number(p.expectedPrice) : 0,
        description: String(p.description || '').slice(0, 200),
        contact: String(p.contact || '').slice(0, 50),
        status: 'open',                // open / closed
        nickName: String(p.nickName || '拾球记用户').slice(0, 30),
        createdAt: now
      }
    });
    return ok({ _id: res._id, demandType });
  } catch (e) {
    console.error('[equipment] publishDemand error', e);
    return fail('DB_ERROR', e.message || '发布失败');
  }
};

// ============ 需求列表 ============
// 可选 demandType: rent / sell / undefined
// 可选 keyword: 模糊匹配 name / description / category
const listDemands = async (event) => {
  await ensureCollection(DEMAND);
  const { demandType, keyword } = event || {};
  const where = { status: 'open' };
  if (demandType === 'rent' || demandType === 'sell') {
    where.demandType = demandType;
  }
  if (keyword && String(keyword).trim()) {
    const kw = String(keyword).trim();
    const re = db.RegExp({ regexp: escapeRegExp(kw), options: 'i' });
    where.$or = [
      { name: re },
      { description: re },
      { category: re }
    ];
  }
  const res = await db.collection(DEMAND)
    .where(where)
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();
  return ok({ list: res.data });
};

// ============ 关闭需求 ============
const closeDemand = async (event) => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '请先登录');
  const { id } = event;
  if (!id) return fail('INVALID_PARAM', 'id 必填');
  try {
    await ensureCollection(DEMAND);
    const cur = await db.collection(DEMAND).doc(id).get();
    if (!cur.data) return fail('NOT_FOUND', '需求不存在');
    if (cur.data._openid !== openid) return fail('FORBIDDEN', '只能关闭自己的需求');
    if (cur.data.status === 'closed') return fail('STATE', '需求已关闭');
    await db.collection(DEMAND).doc(id).update({
      data: { status: 'closed', updatedAt: Date.now() }
    });
    return ok({ id });
  } catch (e) {
    return fail('DB_ERROR', e.message || '关闭失败');
  }
};

// ============ 我发布的需求 ============
const myDemands = async () => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '请先登录');
  await ensureCollection(DEMAND);
  const res = await db.collection(DEMAND)
    .where({ _openid: openid })
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();
  return ok({ list: res.data });
};

exports.main = async (event) => {
  switch (event.type) {
    case 'publish':       return await publish(event);
    case 'list':          return await list(event);
    case 'detail':        return await detail(event);
    case 'borrow':        return await borrow(event);
    case 'cancel':        return await cancel(event);
    case 'myBorrows':     return await myBorrows();
    case 'myPublished':   return await myPublished();
    case 'buy':           return await buy(event);
    case 'cancelBuy':     return await cancelBuy(event);
    case 'myBuys':        return await myBuys();
    case 'publishDemand': return await publishDemand(event);
    case 'listDemands':   return await listDemands(event);
    case 'closeDemand':   return await closeDemand(event);
    case 'myDemands':     return await myDemands();
    default: return fail('INVALID_TYPE', `未知 type：${event.type}`);
  }
};
