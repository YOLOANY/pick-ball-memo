// 云函数 equipment
// 出物共享：支持出租（rent）/ 出售（sell）两种交易模式 + 需求（demand）发布
// 集合：
//   equipment             出物信息（tradeType: rent / sell）
//   equipment_order       租借订单（保留兼容）
//   equipment_buy_order   购买订单
//   equipment_demand      需求/求租/求购
//   equipment_chat        议价会话（一个买家 × 一件出物 = 一条会话）
//   equipment_chat_msg    议价消息（文本 / 出价 / 系统提示）
//  type:
//    出物：
//    'publish'      发布出物（rent / sell）
//    'list'         列表浏览（可按 tradeType 过滤）
//    'detail'       出物详情
//    'borrow'       发起租借（仅 rent）
//    'cancel'       取消租借
//    'myBorrows'    我的租借（我借的）
//    'myPublished'  我发布的出物
//    'buy'          发起购买（仅 sell）
//    'cancelBuy'    取消购买
//    'myBuys'       我买到的
//    需求：
//    'publishDemand' 发布需求
//    'listDemands'   需求列表
//    'closeDemand'   关闭需求
//    'myDemands'     我发布的需求
//    议价：
//    'chatEnsure'      买家侧：进入某出物的议价会话（没有则创建）
//    'chatMessages'    拉取会话消息（顺带把自己这侧未读清零）
//    'chatSend'        发消息（文本 / 出价）
//    'chatAcceptOffer' 同意对方的出价 → 会话敲定 dealPrice
//    'myChats'         我参与的所有会话（买家 + 卖家两种身份）
//    'chatUnread'      我的未读总数（页面红点用）

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const EQUIP = 'equipment';
const ORDER = 'equipment_order';         // 租借订单
const BUY_ORDER = 'equipment_buy_order'; // 购买订单
const DEMAND = 'equipment_demand';       // 需求/求租/求购
const CHAT = 'equipment_chat';           // 议价会话
const CHAT_MSG = 'equipment_chat_msg';   // 议价消息

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

// ============ 发布出物 ============
// payload: { name, category, tradeType, pricePerDay, deposit, salePrice, condition, description, coverUrl, contact, nickName }
const publish = async (event) => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '请先登录');
  const p = event.payload || {};
  if (!p.name) return fail('INVALID_PARAM', '出物名称必填');
  if (!p.category) return fail('INVALID_PARAM', '请选择分类');

  // 交易类型：rent 出租 / sell 出售，默认 rent
  const tradeType = p.tradeType === 'sell' ? 'sell' : 'rent';

  // 根据交易类型校验价格字段
  if (tradeType === 'rent') {
    if (p.pricePerDay === '' || p.pricePerDay === undefined || p.pricePerDay === null || isNaN(p.pricePerDay)) {
      return fail('INVALID_PARAM', '请填写日租金');
    }
    // 押金选填：不传 / 传空按 0 处理，只有传了非数字才拒绝
    if (p.deposit !== '' && p.deposit !== undefined && p.deposit !== null && isNaN(p.deposit)) {
      return fail('INVALID_PARAM', '押金请填数字');
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

// ============ 工具：取会话里已谈定的价格 ============
// 只有满足「会话存在 + 我是该会话的买家 + 会话挂的就是这件出物 + 已达成一致」
// 四个条件才认议定价，否则一律回退到挂牌价，避免被伪造的 chatId 改价
const resolveDealPrice = async (chatId, equipId, openid, listPrice) => {
  if (!chatId) return { price: listPrice, negotiated: false };
  try {
    const c = await db.collection(CHAT).doc(chatId).get();
    const chat = c && c.data;
    if (chat
      && chat.buyerOpenid === openid
      && chat.equipId === equipId
      && chat.dealStatus === 'agreed'
      && Number(chat.dealPrice) > 0) {
      return { price: Number(chat.dealPrice), negotiated: true };
    }
  } catch (e) {
    console.warn('[equipment] resolveDealPrice 读取会话失败，回退挂牌价:', e.message);
  }
  return { price: listPrice, negotiated: false };
};

// ============ 发起租借 ============
// payload 可选 chatId：议价谈成后带上，按议定日租金计费
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
    if (!eq.data) return fail('NOT_FOUND', '出物不存在');
    if (eq.data._openid === openid) return fail('OWN_ITEM', '不能租借自己发布的出物');
    if (eq.data.tradeType === 'sell') return fail('NOT_RENTABLE', '该出物为出售，不可租借');
    if (eq.data.status !== 'available') return fail('UNAVAILABLE', '该出物当前不可租借');

    // 议价：取议定日租金，没谈过就是挂牌价
    const deal = await resolveDealPrice(p.chatId, p.equipId, openid, Number(eq.data.pricePerDay) || 0);

    const now = Date.now();
    const res = await db.collection(ORDER).add({
      data: {
        equipId: p.equipId,
        equipName: eq.data.name,
        equipCover: eq.data.coverUrl,
        days: Number(p.days),
        pricePerDay: deal.price,          // 本单实际按这个日租金结算
        rentFee: Number(p.days) * deal.price,
        deposit: eq.data.deposit || 0,
        negotiated: deal.negotiated,      // true = 价格是聊出来的，列表页打「已议价」标
        listPricePerDay: Number(eq.data.pricePerDay) || 0,
        chatId: deal.negotiated ? p.chatId : '',
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
// payload: { equipId, address, phone, remark, nickName, chatId? }
// chatId 可选：议价谈成后带上，按议定价成交
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
    if (!eq.data) return fail('NOT_FOUND', '出物不存在');
    if (eq.data._openid === openid) return fail('OWN_ITEM', '不能购买自己发布的出物');
    if (eq.data.tradeType !== 'sell') return fail('NOT_FOR_SALE', '该出物仅可租借');
    if (eq.data.status !== 'available') return fail('UNAVAILABLE', '该出物已被购买或下架');

    // 议价：取议定成交价，没谈过就是挂牌价
    const deal = await resolveDealPrice(p.chatId, p.equipId, openid, Number(eq.data.salePrice) || 0);

    const now = Date.now();
    const res = await db.collection(BUY_ORDER).add({
      data: {
        equipId: p.equipId,
        equipName: eq.data.name,
        equipCover: eq.data.coverUrl,
        price: deal.price,                // 本单实际成交价
        negotiated: deal.negotiated,      // true = 价格是聊出来的
        listPrice: Number(eq.data.salePrice) || 0,
        chatId: deal.negotiated ? p.chatId : '',
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

// ============ 我发布的出物 ============
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
  if (!p.name) return fail('INVALID_PARAM', '请填写想要的出物名称');
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

// ==================================================================
// ============ 议价会话（一对一私聊 + 出价） ============
// ==================================================================
// 设计要点：
//   1. 一个「买家 openid × 一件出物」= 一条会话，重复进入复用同一条，不会刷屏
//   2. 会话里显式存 ownerOpenid / buyerOpenid，不依赖 _openid 自动写入
//   3. 未读用会话上的 ownerUnread / buyerUnread 两个计数器维护（_.inc(1) 原子自增），
//      不用「按时间戳去数消息」，省掉每次列表 N 次 count 查询
//   4. 所有读写都在云函数里做鉴权，集合权限保持默认即可

// 工具：读会话 + 鉴权。返回 { chat, myRole } 或 { err }
const loadChat = async (chatId, openid) => {
  const c = await db.collection(CHAT).doc(chatId).get();
  if (!c || !c.data) return { err: fail('NOT_FOUND', '会话不存在') };
  const chat = c.data;
  if (chat.ownerOpenid !== openid && chat.buyerOpenid !== openid) {
    return { err: fail('FORBIDDEN', '无权查看该会话') };
  }
  return { chat, myRole: chat.ownerOpenid === openid ? 'owner' : 'buyer' };
};

// 工具：价格单位。出售是总价，出租是日租金
const priceUnit = (tradeType) => (tradeType === 'sell' ? '' : '/天');

// ============ 进入会话（没有则创建）============
// 只由买家侧调用；发布者是被动方，从「我的出物 → 消息」进入已有会话
const chatEnsure = async (event) => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '请先登录');
  const p = event.payload || {};
  if (!p.equipId) return fail('INVALID_PARAM', 'equipId 必填');

  try {
    await ensureCollection(EQUIP);
    await ensureCollection(CHAT);
    await ensureCollection(CHAT_MSG);

    const eq = await db.collection(EQUIP).doc(p.equipId).get();
    if (!eq.data) return fail('NOT_FOUND', '出物不存在');
    const e = eq.data;
    if (e._openid === openid) return fail('OWN_ITEM', '不能和自己议价');

    // 复用已有会话
    const exist = await db.collection(CHAT)
      .where({ equipId: p.equipId, buyerOpenid: openid })
      .limit(1)
      .get();
    if (exist.data && exist.data.length > 0) {
      return ok({ chatId: exist.data[0]._id, chat: exist.data[0], created: false });
    }

    const isSell = e.tradeType === 'sell';
    const now = Date.now();
    const data = {
      equipId: p.equipId,
      // 出物快照：会话列表直接用，不用回查 equipment
      equipName: String(e.name || '').slice(0, 50),
      equipCover: String(e.coverUrl || ''),
      tradeType: isSell ? 'sell' : 'rent',
      listPrice: isSell ? (Number(e.salePrice) || 0) : (Number(e.pricePerDay) || 0),
      ownerOpenid: e._openid || '',
      ownerNick: String(e.nickName || '发布者').slice(0, 30),
      buyerOpenid: openid,
      buyerNick: String(p.nickName || '拾球记用户').slice(0, 30),
      lastText: '',
      lastAt: now,
      lastFromOpenid: '',
      ownerUnread: 0,
      buyerUnread: 0,
      dealPrice: 0,
      dealStatus: 'none',        // none / agreed
      createdAt: now
    };
    const res = await db.collection(CHAT).add({ data });
    // 关键：不用对象 spread，改 Object.assign（项目已知的 Babel helper 坑）
    return ok({ chatId: res._id, chat: Object.assign({ _id: res._id }, data), created: true });
  } catch (err) {
    console.error('[equipment] chatEnsure error', err);
    return fail('DB_ERROR', err.message || '进入会话失败');
  }
};

// ============ 拉取会话消息 ============
// 顺带把「我这一侧」的未读清零
const chatMessages = async (event) => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '请先登录');
  const { chatId } = event;
  if (!chatId) return fail('INVALID_PARAM', 'chatId 必填');

  try {
    await ensureCollection(CHAT);
    await ensureCollection(CHAT_MSG);
    const r = await loadChat(chatId, openid);
    if (r.err) return r.err;

    const res = await db.collection(CHAT_MSG)
      .where({ chatId })
      .orderBy('createdAt', 'asc')
      .limit(200)
      .get();

    // 清零我这侧未读
    const clear = r.myRole === 'owner' ? { ownerUnread: 0 } : { buyerUnread: 0 };
    await db.collection(CHAT).doc(chatId).update({ data: clear });

    return ok({
      chat: Object.assign({}, r.chat, clear),
      myRole: r.myRole,
      list: res.data || []
    });
  } catch (err) {
    console.error('[equipment] chatMessages error', err);
    return fail('DB_ERROR', err.message || '加载消息失败');
  }
};

// ============ 发消息（文本 / 出价）============
// payload: { chatId, msgType: 'text'|'offer', text, price, nickName }
const chatSend = async (event) => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '请先登录');
  const p = event.payload || {};
  if (!p.chatId) return fail('INVALID_PARAM', 'chatId 必填');

  const msgType = p.msgType === 'offer' ? 'offer' : 'text';
  const text = String(p.text || '').trim().slice(0, 300);
  const price = Number(p.price);
  if (msgType === 'offer') {
    if (!price || isNaN(price) || price <= 0) return fail('INVALID_PARAM', '出价必须大于 0');
  } else if (!text) {
    return fail('INVALID_PARAM', '消息不能为空');
  }

  try {
    await ensureCollection(CHAT);
    await ensureCollection(CHAT_MSG);
    const r = await loadChat(p.chatId, openid);
    if (r.err) return r.err;

    const now = Date.now();
    const msg = {
      chatId: p.chatId,
      fromOpenid: openid,
      fromNick: String(p.nickName || (r.myRole === 'owner' ? r.chat.ownerNick : r.chat.buyerNick) || '用户').slice(0, 30),
      fromRole: r.myRole,                              // owner / buyer
      msgType,                                         // text / offer
      text,
      price: msgType === 'offer' ? price : 0,
      offerStatus: msgType === 'offer' ? 'open' : '',  // open / accepted
      createdAt: now
    };
    const res = await db.collection(CHAT_MSG).add({ data: msg });

    // 更新会话预览 + 给对方未读 +1
    const preview = msgType === 'offer'
      ? `[出价] ¥${price}${priceUnit(r.chat.tradeType)}${text ? ' ' + text : ''}`
      : text;
    const patch = {
      lastText: preview.slice(0, 50),
      lastAt: now,
      lastFromOpenid: openid
    };
    if (r.myRole === 'owner') patch.buyerUnread = _.inc(1);
    else patch.ownerUnread = _.inc(1);
    await db.collection(CHAT).doc(p.chatId).update({ data: patch });

    return ok({ msg: Object.assign({ _id: res._id }, msg) });
  } catch (err) {
    console.error('[equipment] chatSend error', err);
    return fail('DB_ERROR', err.message || '发送失败');
  }
};

// ============ 同意对方的出价 ============
// 双方都能同意对方的出价：买家出价卖家同意，或卖家还价买家同意
const chatAcceptOffer = async (event) => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '请先登录');
  const { chatId, msgId } = event;
  if (!chatId || !msgId) return fail('INVALID_PARAM', 'chatId / msgId 必填');

  try {
    await ensureCollection(CHAT);
    await ensureCollection(CHAT_MSG);
    const r = await loadChat(chatId, openid);
    if (r.err) return r.err;

    const m = await db.collection(CHAT_MSG).doc(msgId).get();
    if (!m || !m.data) return fail('NOT_FOUND', '出价不存在');
    const msg = m.data;
    if (msg.chatId !== chatId) return fail('INVALID_PARAM', '该出价不属于此会话');
    if (msg.msgType !== 'offer') return fail('INVALID_PARAM', '该消息不是出价');
    if (msg.fromOpenid === openid) return fail('FORBIDDEN', '不能同意自己的出价');
    if (msg.offerStatus === 'accepted') return fail('STATE', '该出价已同意过了');

    const now = Date.now();
    const dealPrice = Number(msg.price) || 0;
    await db.collection(CHAT_MSG).doc(msgId).update({ data: { offerStatus: 'accepted' } });

    // 插一条系统消息，聊天记录里留痕，答辩演示看得见
    const sysText = `双方已按 ¥${dealPrice}${priceUnit(r.chat.tradeType)} 达成一致`;
    await db.collection(CHAT_MSG).add({
      data: {
        chatId,
        fromOpenid: '',
        fromNick: '',
        fromRole: 'system',
        msgType: 'system',
        text: sysText,
        price: dealPrice,
        offerStatus: '',
        createdAt: now
      }
    });

    const patch = {
      dealPrice,
      dealStatus: 'agreed',
      lastText: sysText,
      lastAt: now,
      lastFromOpenid: openid
    };
    if (r.myRole === 'owner') patch.buyerUnread = _.inc(1);
    else patch.ownerUnread = _.inc(1);
    await db.collection(CHAT).doc(chatId).update({ data: patch });

    return ok({ dealPrice });
  } catch (err) {
    console.error('[equipment] chatAcceptOffer error', err);
    return fail('DB_ERROR', err.message || '操作失败');
  }
};

// ============ 我参与的所有会话 ============
// 同时覆盖两种身份：我发布的出物收到的咨询 + 我咨询别人的
const myChats = async (event) => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '请先登录');
  try {
    await ensureCollection(CHAT);
    const where = _.or([{ ownerOpenid: openid }, { buyerOpenid: openid }]);
    const res = await db.collection(CHAT)
      .where(where)
      .orderBy('lastAt', 'desc')
      .limit(50)
      .get();

    let list = (res.data || []).map((c) => {
      const isOwner = c.ownerOpenid === openid;
      return Object.assign({}, c, {
        myRole: isOwner ? 'owner' : 'buyer',
        myUnread: (isOwner ? c.ownerUnread : c.buyerUnread) || 0,
        peerNick: isOwner ? c.buyerNick : c.ownerNick
      });
    });
    // 可选：只看某件出物的会话（详情页「收到的咨询」用）
    if (event && event.equipId) {
      list = list.filter((c) => c.equipId === event.equipId);
    }
    return ok({ list });
  } catch (err) {
    console.error('[equipment] myChats error', err);
    return fail('DB_ERROR', err.message || '查询失败');
  }
};

// ============ 我的未读总数（红点用）============
// 未登录不报错，直接返回 0，调用方不用特判
const chatUnread = async () => {
  const openid = getOpenId();
  if (!openid) return ok({ count: 0 });
  try {
    await ensureCollection(CHAT);
    const res = await db.collection(CHAT)
      .where(_.or([{ ownerOpenid: openid }, { buyerOpenid: openid }]))
      .field({ ownerOpenid: true, ownerUnread: true, buyerUnread: true })
      .limit(100)
      .get();
    let count = 0;
    (res.data || []).forEach((c) => {
      count += (c.ownerOpenid === openid ? c.ownerUnread : c.buyerUnread) || 0;
    });
    return ok({ count });
  } catch (err) {
    console.error('[equipment] chatUnread error', err);
    return ok({ count: 0 });   // 红点失败不该阻塞页面
  }
};

exports.main = async (event) => {
  switch (event.type) {
    case 'publish':         return await publish(event);
    case 'list':            return await list(event);
    case 'detail':          return await detail(event);
    case 'borrow':          return await borrow(event);
    case 'cancel':          return await cancel(event);
    case 'myBorrows':       return await myBorrows();
    case 'myPublished':     return await myPublished();
    case 'buy':             return await buy(event);
    case 'cancelBuy':       return await cancelBuy(event);
    case 'myBuys':          return await myBuys();
    case 'publishDemand':   return await publishDemand(event);
    case 'listDemands':     return await listDemands(event);
    case 'closeDemand':     return await closeDemand(event);
    case 'myDemands':       return await myDemands();
    // 议价
    case 'chatEnsure':      return await chatEnsure(event);
    case 'chatMessages':    return await chatMessages(event);
    case 'chatSend':        return await chatSend(event);
    case 'chatAcceptOffer': return await chatAcceptOffer(event);
    case 'myChats':         return await myChats(event);
    case 'chatUnread':      return await chatUnread();
    default: return fail('INVALID_TYPE', `未知 type：${event.type}`);
  }
};
