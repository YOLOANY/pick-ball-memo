// pages/settings/bindPhone.js
// 绑定手机号
// 流程：
//   1) 用户点"获取手机号" → 微信弹授权窗
//   2) 同意后,button 的 getphonenumber 回调拿到 detail.code
//   3) 把 code 传到云函数,云函数用 client_credential / access_token 换真实手机号
//   4) 真实项目里,需要在 cloudfunctions/ballAdd 里加一个 type='bindPhone' 的分支
// 演示版本：只展示流程,不真换手机号,直接保存"已申请"状态

const PHONE_KEY = 'boundPhone'; // 本地存脱敏后的手机号（如 138****1234）或"applied"

Page({
  data: {
    bound: false,
    phoneMasked: '',
    modalVisible: false,
    modalTitle: '',
    modalText: ''
  },

  onLoad() { this._load(); },
  onShow() { this._load(); },

  _load() {
    const phone = wx.getStorageSync(PHONE_KEY) || '';
    const bound = !!phone;
    this.setData({ bound, phoneMasked: phone });
  },

  onGetPhone(e) {
    const { detail } = e || {};
    if (!detail) return;
    if (detail.errMsg && detail.errMsg.includes('deny')) {
      return this._showModal('已取消', '你拒绝了授权,无法绑定手机号');
    }
    if (detail.errMsg && detail.errMsg.includes('not support')) {
      return this._showModal('暂不支持', '当前小程序主体暂未获得手机号授权能力');
    }
    if (!detail.code) {
      return this._showModal('绑定失败', '未拿到授权 code,请重试');
    }
    // 关键：真实项目里应该调 wx.cloud.callFunction 把 code 发到后端
    // 后端用 access_token + code 调 https://api.weixin.qq.com/wxa/business/getuserphonenumber 换真实手机号
    // 这里演示版本:保存"已申请绑定"标记 + 一个示例脱敏号
    console.log('[bindPhone] got code:', detail.code);
    // 真实场景替换为：
    //   const r = await wx.cloud.callFunction({ name: 'ballAdd', data: { type: 'bindPhone', code: detail.code } });
    //   const phone = r.result.data.phoneNumber;
    //   const masked = phone.slice(0,3) + '****' + phone.slice(-4);
    //   wx.setStorageSync(PHONE_KEY, masked);
    const masked = '138****' + String(Math.floor(1000 + Math.random() * 9000));
    wx.setStorageSync(PHONE_KEY, masked);
    this._load();
    wx.showToast({ title: '绑定成功', icon: 'success' });
  },

  onUnbind() {
    wx.showModal({
      title: '解绑手机号?',
      content: '解绑后无法接收手机号相关通知,确定吗?',
      success: (res) => {
        if (res.confirm) {
          wx.removeStorageSync(PHONE_KEY);
          this._load();
          wx.showToast({ title: '已解绑', icon: 'success' });
        }
      }
    });
  },

  _showModal(title, text) {
    this.setData({ modalVisible: true, modalTitle: title, modalText: text });
  },
  onModalClose() { this.setData({ modalVisible: false }); }
});
