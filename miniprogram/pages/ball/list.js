// pages/ball/list.js
// 约球广场列表页
// 职责：
//   1. 拉取 ball_posts 集合中所有 open 状态帖子，按 createdAt 倒序
//   2. 在前端做轻量字段映射（sportLabel / sportEmoji / statusLabel / progress / timeAgo）
//   3. 点击卡片跳转 detail
//   4. 右下角悬浮按钮跳转 publish
//   5. 顶部按球类分类 tab 过滤（前端过滤，云函数一次拉全）
//   6. 根据"运动偏好"重排 tab 顺序，并默认选中第一个偏好

const { get: getPrefs, sortByPref } = require('../../utils/prefs.js');

const SPORT_MAP = {
  tennis:     { label: '网球',   emoji: '🎾' },
  basketball: { label: '篮球',   emoji: '🏀' },
  badminton:  { label: '羽毛球', emoji: '🏸' },
  football:   { label: '足球',   emoji: '⚽' },
  pingpong:   { label: '乒乓球', emoji: '🏓' },
  volleyball: { label: '排球',   emoji: '🏐' }
};

// 分类 tab 基础配置：key 对应 ball_posts.sport；'all' 是兜底
// 实际展示顺序由 _buildCategories 根据偏好动态计算
const CATEGORIES_BASE = [
  { key: 'all',        label: '全部' },
  { key: 'tennis',     label: '网球',   emoji: '🎾' },
  { key: 'basketball', label: '篮球',   emoji: '🏀' },
  { key: 'badminton',  label: '羽毛球', emoji: '🏸' },
  { key: 'football',   label: '足球',   emoji: '⚽' },
  { key: 'pingpong',   label: '乒乓球', emoji: '🏓' },
  { key: 'volleyball', label: '排球',   emoji: '🏐' }
];

const STATUS_MAP = {
  open:    '招募中',
  closed:  '已截止',
  expired: '已截止'    // 到 recruitDeadline 自动视为截止
};

const SCOPE_MAP = {
  all:     '全校',
  college: '本院',
  grade:   '同年级'
};

// 分类空状态文案（按分类给不同提示）
const EMPTY_TEXT = {
  all:        { title: '还没有约球帖子',         sub: '点击右下角按钮，发布第一个吧' },
  tennis:     { title: '还没有网球的约球',       sub: '切换其他分类,或自己发一个网球局' },
  basketball: { title: '还没有篮球的约球',       sub: '切换其他分类,或自己发一个篮球局' },
  badminton:  { title: '还没有羽毛球的约球',     sub: '切换其他分类,或自己发一个羽毛球局' },
  football:   { title: '还没有足球的约球',       sub: '切换其他分类,或自己发一个足球局' },
  pingpong:   { title: '还没有乒乓球的约球',     sub: '切换其他分类,或自己发一个乒乓球局' },
  volleyball: { title: '还没有排球的约球',       sub: '切换其他分类,或自己发一个排球局' }
};

// 根据偏好重排分类：'all' 永远排第一；偏好里的球类排前；其他按原顺序
function buildCategories(prefs) {
  const all = CATEGORIES_BASE.find((c) => c.key === 'all');
  const rest = CATEGORIES_BASE.filter((c) => c.key !== 'all');
  return [all, ...sortByPref(rest, prefs)];
}

Page({
  data: {
    list: [],
    _rawList: [],          // 内部用：从云函数拉到的全集，前端过滤后再渲染
    loading: true,
    noMore: false,
    defaultAvatar: '/images/icons/avatar.png',
    categories: buildCategories([]),   // onLoad 里会用真实偏好重算
    currentCat: 'all',     // 当前选中的分类 key
    catCounts: { all: 0, tennis: 0, basketball: 0, badminton: 0, football: 0, pingpong: 0, volleyball: 0 },
    emptyTitle: EMPTY_TEXT.all.title,
    emptySub:   EMPTY_TEXT.all.sub,
    _preferredSports: []   // 内部用，本次会话的偏好
  },

  onLoad() {
    this._isLoaded = true;
    // 关键：onLoad 时读偏好，重排 tab 顺序，并默认选中第一个偏好
    const prefs = getPrefs();
    this._preferredSports = prefs;
    const initialCat = prefs.length > 0 ? prefs[0] : 'all';
    const et = EMPTY_TEXT[initialCat] || EMPTY_TEXT.all;
    this.setData({
      categories: buildCategories(prefs),
      currentCat: initialCat,
      emptyTitle: et.title,
      emptySub:   et.sub
    });
    this.fetchList();
  },

  // 每次回到列表都刷新一次（发布后切回 tab、详情取消入队后回退都能看到最新）
  // 关键：tabBar 页面 switchTab 不会触发 onLoad，必须靠 onShow 刷新
  // 用 _isLoaded 标记避免每次重复闪一下 loading
  // 同时重新读偏好（用户在"我的"改过后,需要立刻反映到 tab 顺序上）
  onShow() {
    if (this._isLoaded) {
      // 关键：重读偏好并重排 tab；但**不**改 currentCat，保留用户当前选中
      const prefs = getPrefs();
      const changed = JSON.stringify(prefs) !== JSON.stringify(this._preferredSports);
      if (changed) {
        this._preferredSports = prefs;
        this.setData({ categories: buildCategories(prefs) });
      }
      this.fetchList(true);
    }
  },

  // 下拉刷新
  onPullDownRefresh() {
    this.fetchList(true).then(() => {
      wx.stopPullDownRefresh();
    });
  },

  // 切换分类：纯前端过滤，不重新打云函数
  onSwitchCat(e) {
    const cat = e.currentTarget.dataset.cat;
    if (!cat || cat === this.data.currentCat) return;
    this._applyFilter(cat);
  },

  // 空状态里"查看全部"按钮：直接切到全部
  onSwitchAll() {
    this._applyFilter('all');
  },

  // 把 _rawList 按 cat 过滤后写回 list + 更新空状态文案
  _applyFilter(cat) {
    const raw = this.data._rawList || [];
    const filtered = cat === 'all' ? raw : raw.filter((p) => p.sport === cat);
    const et = EMPTY_TEXT[cat] || EMPTY_TEXT.all;
    this.setData({
      currentCat: cat,
      list: filtered,
      emptyTitle: et.title,
      emptySub:   et.sub
    });
  },

  // 拉取列表
  async fetchList(silent = false) {
    if (!silent) this.setData({ loading: true });
    try {
      const resp = await wx.cloud.callFunction({
        name: 'ballAdd',
        data: { type: 'list', pageSize: 50 }
      });
      if (resp.result && resp.result.success) {
        const raw = (resp.result.data.list || []).map((item) => this._mapItem(item));
        // 关键：算出每个分类的数量（含"全部"=总数）
        const counts = { all: raw.length, tennis: 0, basketball: 0, badminton: 0, football: 0, pingpong: 0, volleyball: 0 };
        raw.forEach((p) => { if (counts[p.sport] !== undefined) counts[p.sport]++; });
        // 保持当前选中的分类；按它过滤
        const curCat = this.data.currentCat;
        const filtered = curCat === 'all' ? raw : raw.filter((p) => p.sport === curCat);
        this.setData({
          _rawList: raw,
          list: filtered,
          catCounts: counts,
          loading: false,
          noMore: raw.length < 50
        });
      } else {
        this.setData({ loading: false });
        wx.showToast({
          title: (resp.result && resp.result.errMsg) || '加载失败',
          icon: 'none'
        });
      }
    } catch (e) {
      // 关键：把真实错误打印到控制台 + 用 showModal 显示，方便定位
      console.error('[ball list] fetch failed 真实错误:', e);
      this.setData({ loading: false });
      const realErr = (e && (e.errMsg || e.message)) || JSON.stringify(e);
      wx.showModal({
        title: '云函数调用失败',
        content: '真实错误：\n' + realErr + '\n\n常见原因：\n1. cloudfunctions/ballAdd 没上传\n2. ball_posts 集合未创建\n3. env ID 填错',
        showCancel: false,
        confirmText: '我知道了'
      });
    }
  },

  // 字段映射：把后端原始数据转成前端展示用字段
  _mapItem(item) {
    const sport = SPORT_MAP[item.sport] || { label: item.sport, emoji: '🏅' };
    // 关键：用云函数算好的 effectiveStatus（已考虑 recruitDeadline）
    const eff = item.effectiveStatus || item.status || 'open';
    const statusLabel = STATUS_MAP[eff] || '招募中';
    const progress = Math.min(
      Math.round(((item.currentCount || 1) / (item.needCount || 1)) * 100),
      100
    );
    return {
      ...item,
      sportLabel: sport.label,
      sportEmoji: sport.emoji,
      statusLabel,
      effectiveStatus: eff,
      progress,
      scopeLabel: SCOPE_MAP[item.scope] || '全校',
      timeAgo: this._timeAgo(item.createdAt),
      // 关键：招募截止相关字段
      deadlineText: this._formatDeadline(item.recruitDeadline),
      countdownText: this._formatCountdown(item.secondsLeft)
    };
  },

  // 绝对时间展示：10/15 18:00
  _formatDeadline(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  },

  // 相对时间展示：剩 2天3小时；剩 12分钟；即将截止
  _formatCountdown(secondsLeft) {
    if (!secondsLeft || secondsLeft <= 0) return '';
    if (secondsLeft < 60) return '剩 <1分钟';
    if (secondsLeft < 3600) return `剩 ${Math.floor(secondsLeft / 60)} 分钟`;
    if (secondsLeft < 86400) {
      const h = Math.floor(secondsLeft / 3600);
      const m = Math.floor((secondsLeft % 3600) / 60);
      return `剩 ${h}小时${m > 0 ? m + '分' : ''}`;
    }
    const d = Math.floor(secondsLeft / 86400);
    const h = Math.floor((secondsLeft % 86400) / 3600);
    return `剩 ${d}天${h}小时`;
  },

  // 简单的相对时间
  _timeAgo(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60000);
    if (min < 1) return '刚刚';
    if (min < 60) return `${min}分钟前`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}小时前`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day}天前`;
    const d = new Date(ts);
    return `${d.getMonth() + 1}-${d.getDate()}`;
  },

  // 点击卡片：跳详情
  // 用 eventChannel 把列表里已有的 item 传过去，详情页可以立即渲染不用等云函数
  onTapItem(e) {
    const { id } = e.currentTarget.dataset;
    const item = this.data.list.find((p) => p._id === id);
    wx.navigateTo({
      url: `/pages/ball/detail?id=${id}`,
      success: (res) => {
        if (item && res.eventChannel) {
          res.eventChannel.emit('post', item);
        }
      }
    });
  },

  // 点击悬浮按钮：跳发布
  onTapPublish() {
    wx.navigateTo({ url: '/pages/ball/publish' });
  }
});
