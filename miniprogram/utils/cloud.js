// utils/cloud.js
// 云函数统一调用封装
// 解决问题：原来每个页面 catch 里都固定 toast "云函数未部署"，
// 真实原因（env 错、集合不存在、网络问题、代码异常）被吃掉。
// 这里集中处理：失败时打详细日志，调用方仍可拿到错误自行处理 UI。

/**
 * 调用云函数
 * @param {string} name 云函数名
 * @param {object} data 传入 data
 * @returns {Promise<{result?: any, err?: any}>} 与 wx.cloud.callFunction 形态保持一致
 *
 * 用法：
 *   const { result } = await callCloud('venue', { type: 'list' });
 *   if (result && result.success) { ... }
 */
function callCloud(name, data) {
  return wx.cloud
    .callFunction({ name, data })
    .catch((e) => {
      const app = getApp && getApp();
      const hint =
        app && typeof app._cloudHint === 'function'
          ? app._cloudHint(e)
          : '查看微信开发者工具控制台 + 云开发 → 云函数 → 日志';
      console.error(`[cloud:${name}] 调用失败:`, {
        errMsg: e && (e.errMsg || e.message),
        errCode: e && e.errCode,
        hint
      });
      // 重新抛出，让业务页决定怎么提示用户
      throw e;
    });
}

module.exports = { callCloud };
