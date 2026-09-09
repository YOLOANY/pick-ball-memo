// pages/equipment/detail.js
// 出物详情：根据 tradeType 显示不同操作（出租 → 发起租借 / 出售 → 立即购买）
// 议价：
//   - 非发布者：底部多一个「💬 议价」入口，chatEnsure 后进聊天页
//   - 从聊天页「按此价下单」跳回来时带 ?chatId=xxx，此时按议定价下单
//   - 发布者：显示「收到的咨询 (N)」入口
const app = getApp();
const { callCloud } = require('../../utils/cloud.js');

const CATEGORY_MAP = {
  racket: { label: '球拍类', emoji: '🏸' },
  ball:   { label: '球类',   emoji: '⚽' },
  shoe:   { label: '鞋服',   emoji: '👟' },
  other:  { label: '其他',   emoji: '🎽' }
};

Page({
  data: {
    id: '',
    equip: null,
    isOwner: false,
    // 提交态
    submitting: false,
    // 购买表单
    buyForm: { address: '', phone: '', remark: '' },
    showBuyModal: false,
    defaultAvatar: '/images/icons/avatar.png',
    // ============ 议价相关 ============
    chatId: '',            // 从聊天页跳回来时带的会话 id
    dealPrice: 0,          // 议定价（0 = 没议过）
    dealPriceText: '',     // 展示文案，含单位
    chatCount: 0           // 发布者视角：这件出物收到的咨询数
  },

  onLoad(query) {
    this.setData({
      id: query.id,
      chatId: (query && query.chatId) || ''
    });
    this.fetch();
  },
  // 关键：从聊天页返回时重新拉，议价状态可能变了
  onShow() { if (this.data.equip) this.fetch(); },

  async fetch() {
    try {
      const resp = await callCloud('equipment', { type: 'detail', id: this.data.id });
      if (resp.result && resp.result.success) {
        const e = resp.result.data;
        const me = (app.globalData.userInfo && app.globalData.userInfo._openid) || '';
        const isSell = e.tradeType === 'sell';
        const isOwner = !!(me && e._openid === me);
        // 关键：不用 { ...e, ... } 对象 spread → Babel helper 问题,改用 Object.assign
        this.setData({
          equip: Object.assign({}, e, {
            categoryLabel: (CATEGORY_MAP[e.category] || {}).label || e.category,
            categoryEmoji: (CATEGORY_MAP[e.category] || {}).emoji || '🎽',
            createdAtText: this._fmt(e.createdAt),
            isSell: isSell,
            tradeTypeLabel: isSell ? '出售' : '出租',
            // 价格展示
            priceText: isSell
              ? `¥${e.salePrice || 0}`
              : (e.pricePerDay > 0 ? `¥${e.pricePerDay}` : '免费'),
            priceUnit: isSell ? '' : '/天',
            // 出售时显示的原价（划线价），原价为 0 时不显示
            hasOriginal: isSell && e.originalPrice > 0 && e.originalPrice > (e.salePrice || 0),
            originalText: isSell && e.originalPrice > 0 ? `原价 ¥${e.originalPrice}` : ''
          }),
          isOwner
        });
        // 议价状态：买家带 chatId 回来时查议定价；发布者查收到多少条咨询
        if (isOwner) this._loadChatCount();
        else if (this.data.chatId) this._loadDeal();
      } else {
        wx.showToast({ title: '加载失败', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: '调用失败，请看控制台', icon: 'none' });
    }
  },

  // 读会话里谈定的价格，用于把下单按钮改成「按议定价下单」
  async _loadDeal() {
    try {
      const resp = await callCloud('equipment', { type: 'chatMessages', chatId: this.data.chatId });
      if (resp.result && resp.result.success) {
        const chat = resp.result.data.chat || {};
        if (chat.dealStatus === 'agreed' && chat.dealPrice > 0) {
          const unit = chat.tradeType === 'sell' ? '' : '/天';
          this.setData({
            dealPrice: chat.dealPrice,
            dealPriceText: `¥${chat.dealPrice}${unit}`
          });
        }
      }
    } catch (e) {
      // 议价信息拉不到不影响正常下单，静默降级到挂牌价
      console.warn('[detail] 读取议价信息失败，按挂牌价走', e);
    }
  },

  // 发布者视角：这件出物收到了几条咨询
  async _loadChatCount() {
    try {
      const resp = await callCloud('equipment', { type: 'myChats', equipId: this.data.id });
      if (resp.result && resp.result.success) {
        this.setData({ chatCount: (resp.result.data.list || []).length });
      }
    } catch (e) {
      console.warn('[detail] 读取咨询数失败', e);
    }
  },

  _fmt(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  // 工具：确保已登录，返回 userInfo 或 null
  async _ensureLogin() {
    let userInfo = app.globalData.userInfo;
    if (!userInfo || !userInfo._openid) {
      wx.showLoading({ title: '登录中…', mask: true });
      userInfo = await app.loginSilently();
      wx.hideLoading();
    }
    if (!userInfo || !userInfo._openid) {
      wx.showModal({ title: '提示', content: '请先登录', showCancel: false });
      return null;
    }
    return userInfo;
  },

  // ============ 议价：进入会话 ============
  async onChat() {
    if (this.data.submitting) return;
    const userInfo = await this._ensureLogin();
    if (!userInfo) return;

    this.setData({ submitting: true });
    try {
      const resp = await callCloud('equipment', {
        type: 'chatEnsure',
        payload: { equipId: this.data.id, nickName: userInfo.nickName || '拾球记用户' }
      });
      this.setData({ submitting: false });
      if (resp.result && resp.result.success) {
        wx.navigateTo({ url: `/pages/equipment/chat?chatId=${resp.result.data.chatId}` });
      } else {
        const code = (resp.result && resp.result.errCode) || '';
        const map = { OWN_ITEM: '不能和自己议价' };
        wx.showToast({ title: map[code] || (resp.result && resp.result.errMsg) || '进入失败', icon: 'none' });
      }
    } catch (e) {
      this.setData({ submitting: false });
      wx.showToast({ title: '调用失败，请看控制台', icon: 'none' });
    }
  },

  // 发布者：查看收到的咨询
  onViewChats() { wx.navigateTo({ url: '/pages/equipment/my?tab=chats' }); },

  // ============ 出租：发起租借 ============
  async onBorrow() {
    if (this.data.submitting) return;
    const userInfo = await this._ensureLogin();
    if (!userInfo) return;

    this.setData({ submitting: true });
    try {
      // 议价过就把价格写进确认文案，让用户知道按哪个价下单
      const priceLine = this.data.dealPrice > 0
        ? `按议定价 ${this.data.dealPriceText} 计费。`
        : '';
      const prompt = await new Promise((resolve) => {
        wx.showModal({
          title: '发起租借',
          content: `${priceLine}确认发起租借申请？租借天数由发布者确认后生效。`,
          success: (res) => resolve(res.confirm)
        });
      });
      if (!prompt) { this.setData({ submitting: false }); return; }

      const resp = await callCloud('equipment', {
        type: 'borrow',
        payload: {
          equipId: this.data.id,
          days: 1,
          // 关键：带上 chatId，云函数自己校验会话归属再决定用不用议定价
          chatId: this.data.chatId,
          nickName: userInfo.nickName || '拾球记用户'
        }
      });
      this.setData({ submitting: false });
      if (resp.result && resp.result.success) {
        wx.showToast({ title: '租借成功', icon: 'success' });
        setTimeout(() => wx.navigateTo({ url: '/pages/equipment/my?tab=borrows' }), 800);
      } else {
        const code = (resp.result && resp.result.errCode) || '';
        const map = { OWN_ITEM: '不能租借自己发布的', UNAVAILABLE: '该出物暂不可借', NOT_RENTABLE: '该出物为出售，不可租借' };
        wx.showToast({ title: map[code] || (resp.result && resp.result.errMsg) || '租借失败', icon: 'none' });
      }
    } catch (e) {
      this.setData({ submitting: false });
      wx.showToast({ title: '调用失败，请看控制台', icon: 'none' });
    }
  },

  // ============ 出售：弹出购买表单 ============
  onBuy() {
    if (this.data.submitting) return;
    let userInfo = app.globalData.userInfo;
    if (!userInfo || !userInfo._openid) {
      wx.showLoading({ title: '登录中…', mask: true });
      app.loginSilently().then((u) => {
        wx.hideLoading();
        if (u && u._openid) this.setData({ showBuyModal: true });
        else wx.showModal({ title: '提示', content: '请先登录', showCancel: false });
      });
      return;
    }
    // 预填联系方式（如果用户有手机号）
    this.setData({
      buyForm: { address: '', phone: userInfo.phone || '', remark: '' },
      showBuyModal: true
    });
  },

  closeBuyModal() { this.setData({ showBuyModal: false }); },
  onBuyInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`buyForm.${field}`]: e.detail.value });
  },

  async onConfirmBuy() {
    if (this.data.submitting) return;
    const f = this.data.buyForm;
    if (!f.address.trim()) return wx.showToast({ title: '请填写收货地址', icon: 'none' });
    if (!f.phone.trim()) return wx.showToast({ title: '请填写联系电话', icon: 'none' });

    const userInfo = app.globalData.userInfo || {};
    this.setData({ submitting: true });
    try {
      const resp = await callCloud('equipment', {
        type: 'buy',
        payload: {
          equipId: this.data.id,
          address: f.address.trim(),
          phone: f.phone.trim(),
          remark: f.remark.trim(),
          // 关键：带上 chatId，云函数校验后按议定价成交
          chatId: this.data.chatId,
          nickName: userInfo.nickName || '拾球记用户'
        }
      });
      this.setData({ submitting: false, showBuyModal: false });
      if (resp.result && resp.result.success) {
        wx.showToast({ title: '购买成功', icon: 'success' });
        setTimeout(() => wx.navigateTo({ url: '/pages/equipment/my?tab=buys' }), 800);
      } else {
        const code = (resp.result && resp.result.errCode) || '';
        const map = { OWN_ITEM: '不能购买自己发布的', UNAVAILABLE: '该出物已被购买', NOT_FOR_SALE: '该出物仅可租借' };
        wx.showToast({ title: map[code] || (resp.result && resp.result.errMsg) || '购买失败', icon: 'none' });
      }
    } catch (e) {
      this.setData({ submitting: false });
      wx.showToast({ title: '调用失败，请看控制台', icon: 'none' });
    }
  },

  // 跳转到我的出物页
  onTapMy() {
    const tab = this.data.equip && this.data.equip.isSell ? 'buys' : 'borrows';
    wx.navigateTo({ url: `/pages/equipment/my?tab=${tab}` });
  }
});
