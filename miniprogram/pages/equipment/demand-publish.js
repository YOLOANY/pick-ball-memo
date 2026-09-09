// pages/equipment/demand-publish.js
// 需求发布页：求租 / 求购
const app = getApp();
const { callCloud } = require('../../utils/cloud.js');
Page({
  data: {
    // 需求类型 rent / sell
    demandType: 'rent',
    demandTypeList: [
      { value: 'rent', label: '求租', emoji: '🏸' },
      { value: 'sell', label: '求购', emoji: '🛒' }
    ],
    form: {
      name: '',
      category: 'racket',
      expectedPrice: '',
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
    // 关键：从求物列表跳转时携带 type=sell|rent，对应「求购/求租」tab 自动选中
    if (query && (query.type === 'sell' || query.type === 'rent')) {
      this.setData({ demandType: query.type });
    }
  },
  onInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`form.${field}`]: e.detail.value });
  },
  onSelectCategory(e) { this.setData({ 'form.category': e.currentTarget.dataset.value }); },
  onSelectDemandType(e) { this.setData({ demandType: e.currentTarget.dataset.value }); },

  async onSubmit() {
    if (this.data.submitting) return;
    const f = this.data.form;
    if (!f.name.trim()) return wx.showToast({ title: '请填写出物名称', icon: 'none' });
    if (!f.category) return wx.showToast({ title: '请选择分类', icon: 'none' });

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
        type: 'publishDemand',
        payload: {
          name: f.name.trim(),
          category: f.category,
          demandType: this.data.demandType,
          expectedPrice: f.expectedPrice ? Number(f.expectedPrice) : 0,
          description: f.description.trim(),
          contact: f.contact.trim(),
          nickName: userInfo.nickName || '拾球记用户'
        }
      });
      this.setData({ submitting: false });
      if (resp.result && resp.result.success) {
        wx.showToast({ title: '发布成功', icon: 'success' });
        // 关键：同 publish.js，list 是 tabBar 页只能 switchTab；这里落到「求物」tab
        app.globalData.equipmentListPreset = { viewType: 'demand', filter: this.data.demandType };
        setTimeout(() => wx.switchTab({ url: '/pages/equipment/list' }), 800);
      } else {
        wx.showModal({ title: '发布失败', content: (resp.result && resp.result.errMsg) || '请稍后重试', showCancel: false });
      }
    } catch (e) {
      this.setData({ submitting: false });
      wx.showModal({ title: '发布失败', content: '云函数调用失败，请看控制台日志', showCancel: false });
    }
  }
});
