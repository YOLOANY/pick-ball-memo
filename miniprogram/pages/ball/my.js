// pages/ball/my.js
// 我的约球
// 职责：
//   1. 两个 tab：我发起的（myPosts）/ 我加入的（myJoined）
//   2. 我发起的：能看到全部历史（含 closed / expired，广场里看不到的）
//   3. 我加入的：申请入队过的帖子（含已过期，已自动按 joinedUsers.openid 过滤）
//   4. 卡片复用 list 的字段映射（sportLabel / statusLabel / progress / 截止时间 / 倒计时）
//   5. 点击卡片跳详情，用 eventChannel 传 raw data，详情页立即渲染
//
// 关键：pages/ball/my 不是 tabBar 页面（在 app.json.pages 里，不在 tabBar.list）
//   - 必须用 wx.navigateTo 进来
//   - 第一次进入会触发 onLoad + onShow
//   - 从详情页 wx.navigateBack 回来时只会触发 onShow
//   - 因此 fetchList 必须放在 onLoad 和 onShow 两处都要触发，不能只写在 onLoad
//   - onShow 里用 _isLoaded 守卫曾经是 bug：onLoad 必然先于 onShow 触发，
//     多写一次 fetchList 没问题；但守卫写错位置（this._isLoaded = true 在 fetchList 之后）
//     反而会导致「第一次 onShow 拉到缓存」「从详情页返回后 onShow 不刷新」的问题。
//   - 现在改成：onShow 无条件 fetchList，让它跟 onLoad 各跑一次，互不干扰。

const SPORT_MAP = {
  tennis:     { label: '网球',   emoji: '🎾' },
  basketball: { label: '篮球',   emoji: '🏀' },
  badminton:  { label: '羽毛球', emoji: '🏸' },
  football:   { label: '足球',   emoji: '⚽' },
  pingpong:   { label: '乒乓球', emoji: '🏓' },
  volleyball: { label: '排球',   emoji: '🏐' }
};

// 关键：四个状态在这里区分显示，方便用户看清"是还在招 / 主动关了 / 时间到了 / 招募完成"
//   - open      : 招募中（绿）
//   - closed    : 已关闭（灰，创建者主动 closePost）
//   - expired   : 已过期（橘，到 recruitDeadline）
//   - completed : 已完成（蓝，创建者 confirmComplete 确认满员）
const STATUS_MAP = {
  open:      '招募中',
  closed:    '已关闭',
  expired:   '已过期',
  completed: '已完成'
};

// 关键：历史 tab 用更友好的文案
const HISTORY_STATUS = {
  open:      '已结束',
  closed:    '已关闭',
  expired:   '已过期',
  completed: '已完成'
};

// 工具：解析 post.time 为时间戳（与云函数 parseTs 保持一致）
// 关键：返回 0 表示"无效/过去"，>0 表示"未来"
const parseTs = (s) => {
  if (!s) return 0;
  if (typeof s === 'number') return s;
  const norm = String(s).trim().replace(' ', 'T').replace(/\//g, '-');
  const t = new Date(norm).getTime();
  return Number.isFinite(t) ? t : 0;
};

const EMPTY_TEXT = {
  created: {
    title: '你还没发过约球',
    sub:   '去广场发布一个，把球友约起来'
  },
  joined: {
    title: '你还没加入过约球',
    sub:   '去广场看看，找一个感兴趣的加入吧'
  },
  history: {
    title: '约球历史是空的',
    sub:   '已结束的约球会自动归档到这里'
  }
};

// 关键：发布 vs 查询是否用了同一个 openid 的诊断信息
// - 模拟器 IDE 重启 / 切换云环境 / 清缓存 后，openid 会变
// - 之前发布的帖子 _openid 跟现在不一致 → 列表为空
// - 这里把 openid 前缀显示在空态下方，便于用户自查
const DEBUG_HINT = {
  created: '若已发布却看不到，多半是模拟器 openid 变化（IDE 重启 / 切云环境 / 清缓存后 openid 会变）。',
  joined:  '若已加入却看不到，多半是模拟器 openid 变化。'
};

Page({
  data: {
    tab: 'created',         // 'created' | 'joined'
    list: [],
    loading: false,
    defaultAvatar: '/images/icons/avatar.png',
    emptyText: EMPTY_TEXT.created.title,
    emptySub:  EMPTY_TEXT.created.sub,
    debugHint: DEBUG_HINT.created,
    debugOpenid: '',         // 当前云函数 openid 前缀
    unreadCount: 0           // 提醒中心未读数（status='ready' 数量）
  },

  // ============ 生命周期 ============
  onLoad(query) {
    // 关键：打印 onLoad 触发证据，方便排查"页面是否被加载"
    console.log('[ball my] onLoad fired, query=', JSON.stringify(query || {}));
    // 关键：支持 ?tab=history / ?tab=created / ?tab=joined 直接定位 tab
    // 主要用于"我的 → 设置 → 约球历史"入口进来直接落到历史 tab
    const initTab = (query && query.tab) || 'created';
    const validTab = ['created', 'joined', 'history'].indexOf(initTab) >= 0 ? initTab : 'created';
    if (validTab !== this.data.tab) {
      this.setData({
        tab: validTab,
        emptyText: EMPTY_TEXT[validTab].title,
        emptySub:  EMPTY_TEXT[validTab].sub,
        debugHint: DEBUG_HINT[validTab] || DEBUG_HINT.created
      });
    }
    // 标记已加载（保留字段防止别处还在用，但不再用于守卫 onShow）
    this._isLoaded = true;
    // 第一次进入：直接拉取
    this.fetchList();
  },

  // 关键修复：onShow 必须无条件调用 fetchList
  // 原因：pages/ball/my 是普通页面（navigateTo 进来），从详情页返回时只触发 onShow
  //       守卫 _isLoaded 容易写错时机 → 改无守卫更安全
  onShow() {
    // 关键：在第一行打 marker，用于确认 onShow 是否真的执行
    console.log('[ball my] onShow fired, will fetchList type=', this.data.tab);
    this.fetchList(true);
  },

  onPullDownRefresh() {
    this.fetchList(true).then(() => wx.stopPullDownRefresh());
  },

  onSwitchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.tab) return;
    this.setData({
      tab,
      list: [],
      emptyText: EMPTY_TEXT[tab].title,
      emptySub:  EMPTY_TEXT[tab].sub,
      debugHint: DEBUG_HINT[tab] || DEBUG_HINT.created
    });
    this.fetchList();
  },

  // 拉取「我发起的 / 我加入的 / 约球历史」列表
  // 关键：把云函数真实返回打到控制台 + 写入最近一次 openid 前缀到本地
  //       方便排查"我发布的看不到"问题（常见原因：模拟器 IDE 重启后 openid 变了）
  async fetchList(silent = false) {
    let type;
    if (this.data.tab === 'created')      type = 'myPosts';
    else if (this.data.tab === 'joined')  type = 'myJoined';
    else if (this.data.tab === 'history') type = 'myHistory';
    else type = 'myPosts';
    // 关键：marker - 用户在控制台搜 "[ball my] fetchList" 能看到是否执行
    console.log('[ball my] fetchList start, type=' + type + ', silent=' + !!silent);
    if (!silent) this.setData({ loading: true });
    try {
      const resp = await wx.cloud.callFunction({
        name: 'ballAdd',
        data: { type }
      });
      // 关键：把云函数真实返回打到控制台，方便排查"我发布的看不到"问题
      console.log('[ball my] fetchList type=' + type + ' resp:', JSON.stringify(resp.result || resp));
      // 关键诊断：把云函数返回的 openid 前缀记到本地 + 当前 tab
      const dbg = (resp.result && resp.result.data && resp.result.data._debug) || null;
      if (dbg) {
        try {
          const log = wx.getStorageSync('myDebugLog') || [];
          log.push({
            tab: this.data.tab,
            openid: dbg.openid,
            count: dbg.count,
            ts: Date.now()
          });
          // 只保留最近 20 条，避免 storage 膨胀
          wx.setStorageSync('myDebugLog', log.slice(-20));
        } catch (e) { /* storage 失败不阻塞 */ }
        // 关键：把 openid 前缀显示到空态，让用户能直观看到"我现在的 openid 是多少"
        this.setData({ debugOpenid: dbg.openid || '' });
      }
      let list = [];
      if (resp.result && resp.result.success) {
        let raw = resp.result.data.list || [];
        // 关键：「我发起的 / 我加入的」只显示未来的；「约球历史」已是过去的不用再过滤
        if (this.data.tab === 'created' || this.data.tab === 'joined') {
          const now = Date.now();
          raw = raw.filter((p) => parseTs(p.time) > now);
        }
        list = raw.map((item) => this._mapItem(item));
      } else if (resp.result && resp.result.errCode) {
        // 关键：云函数返回了业务错误时，明确提示用户
        const errMap = {
          NO_AUTH: '请先登录后再试',
          DB_ERROR: '云数据库查询失败，请看控制台'
        };
        wx.showToast({
          title: errMap[resp.result.errCode] || (resp.result.errMsg || '加载失败'),
          icon: 'none'
        });
      }
      // 并行拉取我的所有 pending 提醒，用于给卡片加 🔔 角标
      let remindedSet = {};
      try {
        const r2 = await wx.cloud.callFunction({
          name: 'ballReminder',
          data: { type: 'myReminders' }
        });
        if (r2.result && r2.result.success) {
          (r2.result.data.list || []).forEach((x) => { remindedSet[x.postId] = true; });
        }
      } catch (e) {
        // 静默：拉提醒失败不影响主列表
      }
      // 给每条 item 加 hasReminder
      list = list.map((it) => Object.assign({}, it, { hasReminder: !!remindedSet[it._id] }));
      this.setData({ list, loading: false });

      // 顺手拉取未读数（用于「提醒中心」入口的红点 badge）
      this._fetchUnreadCount();
    } catch (e) {
      console.error('[ball my] fetch failed', e);
      this.setData({ list: [], loading: false });
      const realErr = (e && (e.errMsg || e.message)) || JSON.stringify(e);
      wx.showModal({
        title: '云函数调用失败',
        content: '真实错误：\n' + realErr + '\n\n常见原因：\n1. cloudfunctions/ballAdd 没上传\n2. ball_posts 集合未创建\n3. env ID 填错',
        showCancel: false,
        confirmText: '我知道了'
      });
    }
  },

  async _fetchUnreadCount() {
    try {
      const r = await wx.cloud.callFunction({
        name: 'ballReminder',
        data: { type: 'notificationList' }
      });
      if (r.result && r.result.success) {
        this.setData({ unreadCount: r.result.data.unreadCount || 0 });
      }
    } catch (e) {
      // 静默
    }
  },

  onGoNotifications() {
    wx.navigateTo({ url: '/pages/ball/notifications/notifications' });
  },

  // 点击 🔔：切换该帖的提醒
  // 关键：catchtap 在 WXML 中已阻止冒泡，不会触发 onTapItem 跳详情
  async onToggleReminder(e) {
    const { id, index } = e.currentTarget.dataset;
    const item = this.data.list[index];
    if (!item) return;
    // 根据当前 tab 决定 recipientKind：
    //   created → creator (我是发起人)
    //   joined  → joiner  (我是参与者)
    const recipientKind = this.data.tab === 'created' ? 'creator' : 'joiner';
    const { optInReminder, optOutReminder } = require('../../utils/reminder.js');
    if (!item.hasReminder) {
      const r = await optInReminder({ postId: id, recipientKind: recipientKind });
      if (r && r.ok) {
        this.setData({ [`list[${index}].hasReminder`]: true });
      }
    } else {
      const ok = await optOutReminder(id);
      if (ok) {
        this.setData({ [`list[${index}].hasReminder`]: false });
      }
    }
  },

  // 字段映射：与 list.js 保持一致，保证卡片展示统一
  // 关键：不用 { ...item, ... } 对象 spread → 在该 Babel 配置下会触发
  //        @babel/runtime/helpers/arrayWithHoles 的 require 调用,
  //        改用 Object.assign 达到同样效果
  _mapItem(item) {
    const sport = SPORT_MAP[item.sport] || { label: item.sport || '运动', emoji: '🏅' };
    const eff = item.effectiveStatus || item.status || 'open';
    // 关键：历史 tab 用 HISTORY_STATUS 文案，区别于"我发起的/加入的"
    const statusMap = this.data.tab === 'history' ? HISTORY_STATUS : STATUS_MAP;
    const statusLabel = statusMap[eff] || (this.data.tab === 'history' ? '已结束' : '招募中');
    const progress = Math.min(
      Math.round(((item.currentCount || 1) / (item.needCount || 1)) * 100),
      100
    );
    return Object.assign({}, item, {
      sportLabel: sport.label,
      sportEmoji: sport.emoji,
      statusLabel,
      effectiveStatus: eff,
      progress,
      timeAgo: this._timeAgo(item.createdAt),
      deadlineText: this._formatDeadline(item.recruitDeadline),
      countdownText: this._formatCountdown(item.secondsLeft)
    });
  },

  _formatDeadline(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  },

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

  onTapItem(e) {
    const { id, index } = e.currentTarget.dataset;
    const item = this.data.list[index];
    if (!item) return;
    wx.navigateTo({
      url: `/pages/ball/detail?id=${id}`,
      success: (res) => {
        // 关键：把当前行的 raw post 通过 eventChannel 传过去，详情页能立即渲染
        if (res.eventChannel) {
          res.eventChannel.emit('post', item);
        }
      }
    });
  },

  onGoList() {
    wx.switchTab({ url: '/pages/ball/list' });
  },

  // ============ 卡片底部操作行：占位 catchtap 防止冒泡触发 onTapItem ============
  onTapCardActions() {
    // no-op：仅用于吞掉冒泡到卡片的点击
  },

  // ============ 删除我发起的帖子（仅当还没招到人时可用） ============
  // 关键：currentCount <= 1 表示还没人入队（创建者算 1 人），允许一键删除
  //       已招到人时按钮置灰，避免误操作导致其他成员失去约球
  async onDeleteMyPost(e) {
    // 阻止冒泡到卡片 → 不会跳详情
    // catchtap 在 WXML 里已经处理，这里只是保险
    const { id, index } = e.currentTarget.dataset;
    const item = this.data.list[index];
    if (!item) return;
    if ((item.currentCount || 0) > 1) {
      return wx.showToast({
        title: '已招到球友，请去详情页处理',
        icon: 'none'
      });
    }
    // 二次确认
    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: '确认删除？',
        content: '删除后无法恢复，招募信息将彻底消失。',
        success: (res) => resolve(!!res.confirm)
      });
    });
    if (!confirmed) return;

    wx.showLoading({ title: '删除中…', mask: true });
    try {
      const resp = await wx.cloud.callFunction({
        name: 'ballAdd',
        data: { type: 'delete', id: id }
      });
      wx.hideLoading();
      if (resp.result && resp.result.success) {
        wx.showToast({ title: '已删除', icon: 'success' });
        // 直接从本地 list 移除，避免再发一次 fetchList
        const newList = this.data.list.filter((_, i) => i !== index);
        this.setData({ list: newList });
      } else {
        const errMap = {
          FORBIDDEN: '只有发起人可以删除',
          NOT_FOUND: '帖子不存在或已删除',
          DB_ERROR: '数据库错误'
        };
        const code = (resp.result && resp.result.errCode) || '';
        wx.showToast({
          title: errMap[code] || (resp.result && resp.result.errMsg) || '删除失败',
          icon: 'none'
        });
      }
    } catch (err) {
      wx.hideLoading();
      console.error('[ball my] delete failed', err);
      wx.showToast({ title: '网络异常', icon: 'none' });
    }
  }
});
