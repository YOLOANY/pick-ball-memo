// pages/ball/my.js
// 我的约球
// 职责：
//   1. 两个 tab：我发起的（myPosts）/ 我加入的（myJoined）
//   2. 我发起的：能看到全部历史（含 closed / expired，广场里看不到的）
//   3. 我加入的：申请入队过的帖子（含已过期，已自动按 joinedUsers.openid 过滤）
//   4. 卡片复用 list 的字段映射（sportLabel / statusLabel / progress / 截止时间 / 倒计时）
//   5. 点击卡片跳详情，用 eventChannel 传 raw data，详情页立即渲染

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

const EMPTY_TEXT = {
  created: {
    title: '你还没发过约球',
    sub:   '去广场发布一个，把球友约起来'
  },
  joined: {
    title: '你还没加入过约球',
    sub:   '去广场看看，找一个感兴趣的加入吧'
  }
};

Page({
  data: {
    tab: 'created',         // 'created' | 'joined'
    list: [],
    loading: false,
    defaultAvatar: '/images/icons/avatar.png',
    emptyText: EMPTY_TEXT.created.title,
    emptySub:  EMPTY_TEXT.created.sub,
    unreadCount: 0           // 提醒中心未读数（status='ready' 数量）
  },

  onLoad() {
    this._isLoaded = true;
    this.fetchList();
  },

  // 从详情返回时刷新（取消入队等场景）
  onShow() {
    if (this._isLoaded) this.fetchList(true);
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
      emptySub:  EMPTY_TEXT[tab].sub
    });
    this.fetchList();
  },

  async fetchList(silent = false) {
    if (!silent) this.setData({ loading: true });
    const type = this.data.tab === 'created' ? 'myPosts' : 'myJoined';
    try {
      const resp = await wx.cloud.callFunction({
        name: 'ballAdd',
        data: { type }
      });
      let list = [];
      if (resp.result && resp.result.success) {
        const raw = resp.result.data.list || [];
        list = raw.map((item) => this._mapItem(item));
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
      wx.showToast({ title: '网络异常', icon: 'none' });
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
    const statusLabel = STATUS_MAP[eff] || '招募中';
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
  }
});
