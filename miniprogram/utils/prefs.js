// utils/prefs.js
// 用户的"运动偏好"
// 存储：本地缓存（wx.setStorageSync），单设备即可
//        后续若需跨设备同步，可改为云函数 + user_prefs 集合

const KEY = 'preferredSports';

// 全部可选运动（key 与 ball_posts.sport 保持一致）
const SPORT_OPTIONS = [
  { key: 'tennis',     label: '网球',   emoji: '🎾' },
  { key: 'basketball', label: '篮球',   emoji: '🏀' },
  { key: 'badminton',  label: '羽毛球', emoji: '🏸' },
  { key: 'football',   label: '足球',   emoji: '⚽' },
  { key: 'pingpong',   label: '乒乓球', emoji: '🏓' },
  { key: 'volleyball', label: '排球',   emoji: '🏐' }
];

// 工具：读取偏好（永远返回数组）
function get() {
  try {
    const v = wx.getStorageSync(KEY);
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

// 工具：写入偏好（自动过滤无效 key）
function set(sports) {
  try {
    const valid = new Set(SPORT_OPTIONS.map((o) => o.key));
    const clean = (Array.isArray(sports) ? sports : []).filter((s) => valid.has(s));
    wx.setStorageSync(KEY, clean);
    return true;
  } catch (e) {
    console.error('[prefs] set failed', e);
    return false;
  }
}

// 工具：把 [tennis, basketball] → [{key,label,emoji}, ...]
function expand(keys) {
  return SPORT_OPTIONS.filter((o) => (keys || []).includes(o.key));
}

// 工具：按偏好重排一个分类列表
// 规则：偏好里的项排前（按偏好顺序），其他保持原顺序
//   输入 items: [{key, ...}, ...]
//   输入 prefKeys: ['tennis', 'basketball', ...]
function sortByPref(items, prefKeys) {
  if (!prefKeys || prefKeys.length === 0) return items;
  const set = new Set(prefKeys);
  const preferred = items.filter((it) => set.has(it.key));
  const rest = items.filter((it) => !set.has(it.key));
  // preferred 内部按 prefKeys 顺序
  preferred.sort((a, b) => prefKeys.indexOf(a.key) - prefKeys.indexOf(b.key));
  return [...preferred, ...rest];
}

module.exports = { SPORT_OPTIONS, get, set, expand, sortByPref };
