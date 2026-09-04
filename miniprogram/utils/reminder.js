// utils/reminder.js
// 「提前 2 小时提醒」—— 应用内消息中心方案
// 大创项目说明：因订阅消息要求小程序正式发布 + 模板审核，
// 本项目改用「云函数定时器 → 写入 ready → 前端 App.onShow 拉取弹窗」的方案
//
// 用法：
//   const { optInReminder, optOutReminder } = require('../../utils/reminder.js');
//   const r = await optInReminder({ postId, recipientKind: 'creator' | 'joiner' });
//   await optOutReminder(postId);

const { callCloud } = require('./cloud.js');

// 业务错误码 → 用户友好提示
const MSG_MAP = {
  PAST_TIME:     '活动已开始，无需提醒',
  CLOSED:        '该帖已关闭',
  EXPIRED:       '该帖已过期',
  FORBIDDEN:     '当前用户无权限',
  NOT_FOUND:     '帖子不存在',
  INVALID_PARAM: '参数错误'
};

/**
 * 用户主动开启提醒
 * 直接调 ballReminder.addReminder 写记录，<2h 时服务端会自动用 now 作 remindAt
 * 返回 { ok: boolean, reason?, remindAt? }
 */
function optInReminder(opt) {
  const postId = opt && opt.postId;
  const recipientKind = opt && opt.recipientKind;
  return callCloud('ballReminder', {
    type: 'addReminder',
    postId: postId,
    recipientKind: recipientKind
  })
    .then((r) => {
      if (r.result && r.result.success) {
        wx.showToast({ title: '已开启提醒', icon: 'success' });
        return { ok: true, remindAt: r.result.data.remindAt };
      }
      const code = (r.result && r.result.errCode) || '';
      const msg = MSG_MAP[code] || (r.result && r.result.errMsg) || '开启失败';
      wx.showToast({ title: msg, icon: 'none' });
      return { ok: false, reason: code || 'cloud_error' };
    })
    .catch(() => {
      wx.showToast({ title: '网络异常', icon: 'none' });
      return { ok: false, reason: 'cloud_error' };
    });
}

/**
 * 用户主动关闭提醒
 */
function optOutReminder(postId) {
  if (!postId) return Promise.resolve(false);
  return callCloud('ballReminder', { type: 'cancelReminder', postId: postId })
    .then((r) => {
      if (r.result && r.result.success) {
        wx.showToast({ title: '已关闭提醒', icon: 'success' });
        return true;
      }
      wx.showToast({
        title: (r.result && r.result.errMsg) || '操作失败',
        icon: 'none'
      });
      return false;
    })
    .catch(() => {
      wx.showToast({ title: '网络异常', icon: 'none' });
      return false;
    });
}

module.exports = { optInReminder, optOutReminder };
