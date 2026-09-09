// pages/equipment/chat.js
// 议价咨询：买家 ↔ 发布者 一对一私聊，消息分「文本」和「出价」两类
//
// 进入方式：
//   1. 买家：出物详情页点「💬 议价」→ 先 chatEnsure 拿到 chatId 再跳进来
//   2. 发布者：我的出物 → 消息 tab → 点会话进来（此时 chatId 已知）
// 所以本页只认 chatId，不负责建会话
//
// 关于刷新：不做轮询（云函数调用量 + 竞赛演示场景不需要），
//          靠 onShow / 下拉刷新 / 发消息后本地追加 三种方式更新
const app = getApp();
const { callCloud } = require('../../utils/cloud.js');

Page({
  data: {
    chatId: '',
    chat: null,
    myRole: '',            // owner / buyer
    msgs: [],
    loading: true,
    sending: false,
    // 输入框
    draft: '',
    // 出价弹层
    showOfferModal: false,
    offerPrice: '',
    // scroll-view 锚点：始终滚到最后一条
    scrollIntoId: '',
    // 顶部出物条展示用
    listPriceText: '',
    dealPriceText: '',
    // 买家 + 已谈成 时，底部出现「按此价下单」
    canOrder: false
  },

  onLoad(query) {
    if (!query || !query.chatId) {
      wx.showToast({ title: '缺少会话参数', icon: 'none' });
      return;
    }
    this.setData({ chatId: query.chatId });
    this.fetch();
  },
  // 关键：从下单页返回时重新拉一次，保证议价状态是最新的
  onShow() { if (this.data.chatId && !this.data.loading) this.fetch(true); },
  onPullDownRefresh() { this.fetch(true).then(() => wx.stopPullDownRefresh()); },

  async fetch(silent) {
    if (!silent) this.setData({ loading: true });
    try {
      const resp = await callCloud('equipment', { type: 'chatMessages', chatId: this.data.chatId });
      if (resp.result && resp.result.success) {
        const d = resp.result.data;
        const chat = d.chat || {};
        const myRole = d.myRole;
        const agreed = chat.dealStatus === 'agreed';
        const unit = chat.tradeType === 'sell' ? '' : '/天';
        this.setData({
          chat,
          myRole,
          msgs: this._decorate(d.list || [], chat, myRole),
          loading: false,
          listPriceText: `¥${chat.listPrice || 0}${unit}`,
          dealPriceText: agreed ? `¥${chat.dealPrice}${unit}` : '',
          // 只有买家能下单；卖家看到的是「等对方下单」
          canOrder: agreed && myRole === 'buyer'
        });
        this._scrollToBottom();
      } else {
        this.setData({ loading: false });
        wx.showToast({ title: (resp.result && resp.result.errMsg) || '加载失败', icon: 'none' });
      }
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: '调用失败，请看控制台', icon: 'none' });
    }
  },

  // 把云端的原始消息加工成 WXML 直接能用的形状
  // 关键：所有判断都在 JS 里算好，WXML 里不写复杂表达式（项目已知的基础库兼容坑）
  _decorate(list, chat, myRole) {
    const me = (app.globalData.userInfo && app.globalData.userInfo._openid) || '';
    const unit = chat.tradeType === 'sell' ? '' : '/天';
    const agreed = chat.dealStatus === 'agreed';
    return list.map((m) => {
      const isSystem = m.msgType === 'system';
      const isOffer = m.msgType === 'offer';
      // 优先用 fromRole 判断归属（比 openid 可靠：openid 可能还没登录拿到）
      const mine = !isSystem && (m.fromRole === myRole || (me && m.fromOpenid === me));
      return Object.assign({}, m, {
        mine,
        isSystem,
        isOffer,
        priceText: isOffer ? `¥${m.price}${unit}` : '',
        timeText: this._fmt(m.createdAt),
        // 只能同意「对方发的 + 还没被接受的 + 会话尚未谈成的」出价
        canAccept: isOffer && !mine && m.offerStatus !== 'accepted' && !agreed,
        isAccepted: isOffer && m.offerStatus === 'accepted'
      });
    });
  },

  _scrollToBottom() {
    const msgs = this.data.msgs;
    if (!msgs.length) return;
    // 关键：setData 之后再设锚点，否则节点还没渲染出来，scroll-into-view 定位不到
    wx.nextTick(() => {
      this.setData({ scrollIntoId: 'msg-' + msgs[msgs.length - 1]._id });
    });
  },

  _fmt(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const today = new Date();
    const sameDay = d.getFullYear() === today.getFullYear()
      && d.getMonth() === today.getMonth()
      && d.getDate() === today.getDate();
    return sameDay ? `${hh}:${mm}` : `${d.getMonth() + 1}-${d.getDate()} ${hh}:${mm}`;
  },

  // ============ 输入 ============
  onDraftInput(e) { this.setData({ draft: e.detail.value }); },

  async onSendText() {
    const text = (this.data.draft || '').trim();
    if (!text) return;
    await this._send({ msgType: 'text', text });
    this.setData({ draft: '' });
  },

  // ============ 出价 ============
  onOpenOffer() {
    // 默认填当前挂牌价，用户在这个基础上改，比空着好用
    const chat = this.data.chat || {};
    this.setData({ showOfferModal: true, offerPrice: String(chat.listPrice || '') });
  },
  onCloseOffer() { this.setData({ showOfferModal: false }); },
  onOfferInput(e) { this.setData({ offerPrice: e.detail.value }); },

  async onConfirmOffer() {
    const price = Number(this.data.offerPrice);
    if (!price || isNaN(price) || price <= 0) {
      return wx.showToast({ title: '请填写大于 0 的价格', icon: 'none' });
    }
    this.setData({ showOfferModal: false });
    await this._send({ msgType: 'offer', price, text: (this.data.draft || '').trim() });
    this.setData({ draft: '' });
  },

  async _send(payloadPart) {
    if (this.data.sending) return;
    const userInfo = app.globalData.userInfo || {};
    this.setData({ sending: true });
    try {
      const payload = Object.assign({
        chatId: this.data.chatId,
        nickName: userInfo.nickName || '拾球记用户'
      }, payloadPart);
      const resp = await callCloud('equipment', { type: 'chatSend', payload });
      this.setData({ sending: false });
      if (resp.result && resp.result.success) {
        // 本地直接追加，不用整页重拉，输入体验更跟手
        const one = this._decorate([resp.result.data.msg], this.data.chat, this.data.myRole);
        this.setData({ msgs: this.data.msgs.concat(one) });
        this._scrollToBottom();
      } else {
        wx.showToast({ title: (resp.result && resp.result.errMsg) || '发送失败', icon: 'none' });
      }
    } catch (e) {
      this.setData({ sending: false });
      wx.showToast({ title: '发送失败，请看控制台', icon: 'none' });
    }
  },

  // ============ 同意出价 ============
  async onAcceptOffer(e) {
    const { id, price } = e.currentTarget.dataset;
    const unit = (this.data.chat || {}).tradeType === 'sell' ? '' : '/天';
    const confirmed = await new Promise((r) => wx.showModal({
      title: '确认议价',
      content: `确认按 ¥${price}${unit} 成交？确认后价格锁定，可直接下单。`,
      success: (res) => r(res.confirm)
    }));
    if (!confirmed) return;
    try {
      const resp = await callCloud('equipment', {
        type: 'chatAcceptOffer',
        chatId: this.data.chatId,
        msgId: id
      });
      if (resp.result && resp.result.success) {
        wx.showToast({ title: '已达成一致', icon: 'success' });
        this.fetch(true);
      } else {
        wx.showToast({ title: (resp.result && resp.result.errMsg) || '操作失败', icon: 'none' });
      }
    } catch (err) {
      wx.showToast({ title: '调用失败，请看控制台', icon: 'none' });
    }
  },

  // ============ 跳转 ============
  // 按议定价下单：回详情页并带上 chatId，由详情页走原有的租借/购买流程
  // 这样不用在聊天页重复实现收货地址那套表单
  onGoOrder() {
    const chat = this.data.chat || {};
    wx.redirectTo({ url: `/pages/equipment/detail?id=${chat.equipId}&chatId=${this.data.chatId}` });
  },

  onTapEquip() {
    const chat = this.data.chat || {};
    wx.navigateTo({ url: `/pages/equipment/detail?id=${chat.equipId}` });
  }
});
