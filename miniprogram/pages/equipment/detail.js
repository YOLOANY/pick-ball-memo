// pages/equipment/detail.js
// 器材详情：根据 tradeType 显示不同操作（出租 → 发起租借 / 出售 → 立即购买）
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
    defaultAvatar: '/images/icons/avatar.png'
  },

  onLoad(query) { this.setData({ id: query.id }); this.fetch(); },

  async fetch() {
    try {
      const resp = await callCloud('equipment', { type: 'detail', id: this.data.id });
      if (resp.result && resp.result.success) {
        const e = resp.result.data;
        const me = (app.globalData.userInfo && app.globalData.userInfo._openid) || '';
        const isSell = e.tradeType === 'sell';
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
          isOwner: me && e._openid === me
        });
      } else {
        wx.showToast({ title: '加载失败', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: '调用失败，请看控制台', icon: 'none' });
    }
  },

  _fmt(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  // ============ 出租：发起租借 ============
  async onBorrow() {
    if (this.data.submitting) return;
    let userInfo = app.globalData.userInfo;
    if (!userInfo || !userInfo._openid) {
      wx.showLoading({ title: '登录中…', mask: true });
      userInfo = await app.loginSilently();
      wx.hideLoading();
    }
    if (!userInfo || !userInfo._openid) return wx.showModal({ title: '提示', content: '请先登录', showCancel: false });

    this.setData({ submitting: true });
    try {
      const prompt = await new Promise((resolve) => {
        wx.showModal({
          title: '发起租借',
          content: '确认发起租借申请？租借天数由发布者确认后生效。',
          success: (res) => resolve(res.confirm)
        });
      });
      if (!prompt) { this.setData({ submitting: false }); return; }

      const resp = await callCloud('equipment', {
        type: 'borrow',
        payload: { equipId: this.data.id, days: 1, nickName: userInfo.nickName || '拾球记用户' }
      });
      this.setData({ submitting: false });
      if (resp.result && resp.result.success) {
        wx.showToast({ title: '租借成功', icon: 'success' });
        setTimeout(() => wx.navigateTo({ url: '/pages/equipment/my?tab=borrows' }), 800);
      } else {
        const code = (resp.result && resp.result.errCode) || '';
        const map = { OWN_ITEM: '不能租借自己发布的', UNAVAILABLE: '该器材暂不可借', NOT_RENTABLE: '该器材为出售，不可租借' };
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
          nickName: userInfo.nickName || '拾球记用户'
        }
      });
      this.setData({ submitting: false, showBuyModal: false });
      if (resp.result && resp.result.success) {
        wx.showToast({ title: '购买成功', icon: 'success' });
        setTimeout(() => wx.navigateTo({ url: '/pages/equipment/my?tab=buys' }), 800);
      } else {
        const code = (resp.result && resp.result.errCode) || '';
        const map = { OWN_ITEM: '不能购买自己发布的', UNAVAILABLE: '该器材已被购买', NOT_FOR_SALE: '该器材仅可租借' };
        wx.showToast({ title: map[code] || (resp.result && resp.result.errMsg) || '购买失败', icon: 'none' });
      }
    } catch (e) {
      this.setData({ submitting: false });
      wx.showToast({ title: '调用失败，请看控制台', icon: 'none' });
    }
  },

  // 跳转到我的器材页
  onTapMy() {
    const tab = this.data.equip && this.data.equip.isSell ? 'buys' : 'borrows';
    wx.navigateTo({ url: `/pages/equipment/my?tab=${tab}` });
  }
});
