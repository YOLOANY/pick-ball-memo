// pages/equipment/publish.js
// 器材共享发布页：支持出租（rent）/ 出售（sell）两种模式
const app = getApp();
const { callCloud } = require('../../utils/cloud.js');
Page({
  data: {
    // 顶部交易类型 tab
    tradeType: 'rent',                  // rent / sell
    tradeTypeList: [
      { value: 'rent', label: '出租' },
      { value: 'sell', label: '出售' }
    ],
    form: {
      name: '',
      category: 'racket',
      // 出租字段
      pricePerDay: '',
      deposit: '',
      // 出售字段
      salePrice: '',
      originalPrice: '',
      // 共有字段
      condition: '九成新',
      description: '',
      contact: ''
    },
    categoryList: [
      { value: 'racket', label: '球拍类', emoji: '🏸' },
      { value: 'ball',   label: '球类',   emoji: '⚽' },
      { value: 'shoe',   label: '鞋服',   emoji: '👟' },
      { value: 'other',  label: '其他',   emoji: '🎽' }
    ],
    submitting: false
  },
  onLoad(query) {
    // 关键：从列表页跳转时携带 type=sell|rent，避免每次都要手动切换 tab
    if (query && (query.type === 'sell' || query.type === 'rent')) {
      this.setData({ tradeType: query.type });
    }
  },
  onInput(e) {
    // 关键：value 在 e.detail.value，data-field 在 e.currentTarget.dataset
    const { field } = e.currentTarget.dataset;
    const value = e.detail.value;
    this.setData({ [`form.${field}`]: value });
  },
  onSelectCategory(e) { this.setData({ 'form.category': e.currentTarget.dataset.value }); },
  onSelectTradeType(e) {
    this.setData({ tradeType: e.currentTarget.dataset.value });
  },

  async onSubmit() {
    if (this.data.submitting) return;
    const f = this.data.form;
    const tradeType = this.data.tradeType;

    if (!f.name.trim()) return wx.showToast({ title: '请填写器材名称', icon: 'none' });
    if (!f.category) return wx.showToast({ title: '请选择分类', icon: 'none' });

    // 根据交易类型校验
    if (tradeType === 'rent') {
      if (f.pricePerDay === '' || isNaN(f.pricePerDay)) return wx.showToast({ title: '请填写日租金', icon: 'none' });
      if (Number(f.pricePerDay) < 0) return wx.showToast({ title: '日租金不能为负', icon: 'none' });
      if (f.deposit === '' || isNaN(f.deposit)) return wx.showToast({ title: '请填写押金', icon: 'none' });
      if (Number(f.deposit) < 0) return wx.showToast({ title: '押金不能为负', icon: 'none' });
    } else {
      if (f.salePrice === '' || isNaN(f.salePrice)) return wx.showToast({ title: '请填写出售价格', icon: 'none' });
      if (Number(f.salePrice) <= 0) return wx.showToast({ title: '出售价格必须大于 0', icon: 'none' });
    }

    let userInfo = app.globalData.userInfo;
    if (!userInfo || !userInfo._openid) {
      wx.showLoading({ title: '登录中…', mask: true });
      userInfo = await app.loginSilently();
      wx.hideLoading();
    }
    if (!userInfo || !userInfo._openid) return wx.showModal({ title: '提示', content: '请先登录', showCancel: false });

    const profile = await app.ensureUserProfile();
    userInfo = profile || userInfo;

    const payload = {
      name: f.name.trim(),
      category: f.category,
      tradeType,
      condition: f.condition.trim(),
      description: f.description.trim(),
      contact: f.contact.trim(),
      nickName: userInfo.nickName || '拾球记用户'
    };
    if (tradeType === 'rent') {
      payload.pricePerDay = Number(f.pricePerDay);
      payload.deposit = Number(f.deposit);
    } else {
      payload.salePrice = Number(f.salePrice);
      payload.originalPrice = f.originalPrice ? Number(f.originalPrice) : 0;
    }

    this.setData({ submitting: true });
    try {
      const resp = await callCloud('equipment', { type: 'publish', payload });
      this.setData({ submitting: false });
      if (resp.result && resp.result.success) {
        wx.showToast({ title: '发布成功', icon: 'success' });
        setTimeout(() => wx.redirectTo({ url: '/pages/equipment/list' }), 800);
      } else {
        wx.showModal({ title: '发布失败', content: (resp.result && resp.result.errMsg) || '请稍后重试', showCancel: false });
      }
    } catch (e) {
      this.setData({ submitting: false });
      wx.showModal({ title: '发布失败', content: '云函数调用失败，请看控制台日志', showCancel: false });
    }
  }
});
