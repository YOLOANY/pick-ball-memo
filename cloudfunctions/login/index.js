// 云函数 login
// 职责：小程序静默登录，返回 openid 等基础身份信息
// 调用方式：wx.cloud.callFunction({ name: 'login' })
// 返回：{ success, data: { openid, appid, unionid } }
//
// 为什么不存 users 表？
//   - 静默登录阶段只确认身份，不强制用户授权
//   - 真正的昵称/头像在用户主动点击"完善资料"时再写库
//   - 这样降低首次进入的门槛，演示更流畅

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async () => {
  const wxContext = cloud.getWXContext();
  return {
    success: true,
    data: {
      openid: wxContext.OPENID || '',
      appid: wxContext.APPID || '',
      unionid: wxContext.UNIONID || ''
    }
  };
};
