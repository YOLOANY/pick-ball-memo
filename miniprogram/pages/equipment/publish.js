// pages/equipment/publish.js
const app = getApp();
const { callCloud } = require('../../utils/cloud.js');
Page({
  data: {
    form: { name: '', category: 'racket', pricePerDay: '', deposit: '', condition: '九成新', description: '', contact: '' },
    categoryList: [
      { value: 'racket', label: '球拍类', emoji: '🏸' },
      { value: 'ball',   label: '球类',   emoji: '⚽' },
      { value: 'shoe',   label: '鞋服',   emoji: '👟' },
      { value: 'other',  label: '其他',   emoji: '🎽' }
    ],
    submitting: false
  },
  onLoad() {},
  onInput(e) {
    // 关键：value 在 e.detail.value，data-field 在 e.currentTarget.dataset
    const { field } = e.currentTarget.dataset;
    const value = e.detail.value;
    this.setData({ [`form.${field}`]: value });
  },
  onSelectCategory(e) { this.setData({ 'form.category': e.currentTarget.dataset.value }); },

  async onSubmit() {
    if (this.data.submitting) return;
    const f = this.data.form;
    if (!f.name.trim()) return wx.showToast({ title: '请填写器材名称', icon: 'none' });
    if (f.pricePerDay === '' || isNaN(f.pricePerDay)) return wx.showToast({ title: '请填写日租金', icon: 'none' });
    if (f.deposit === '' || isNaN(f.deposit)) return wx.showToast({ title: '请填写押金', icon: 'none' });

    let userInfo = app.globalData.userInfo;
    if (!userInfo || !userInfo._openid) {
      wx.showLoading({ title: '登录中…', mask: true });
      userInfo = await app.loginSilently();
      wx.hideLoading();
    }
    if (!userInfo || !userInfo._openid) return wx.showModal({ title: '提示', content: '请先登录', showCancel: false });

    const profile = await app.ensureUserProfile();
    userInfo = profile || userInfo;

    this.setData({ submitting: true });
    try {
      const resp = await callCloud('equipment', {
        type: 'publish',
        payload: {
          name: f.name.trim(),
          category: f.category,
          pricePerDay: Number(f.pricePerDay),
          deposit: Number(f.deposit),
          condition: f.condition.trim(),
          description: f.description.trim(),
          contact: f.contact.trim(),
          nickName: userInfo.nickName || '拾球记用户'
        }
      });
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
