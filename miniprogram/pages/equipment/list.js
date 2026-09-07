// pages/equipment/list.js
// 器材共享列表：搜索 + 两级 tab（器材/需求 → 全部/出租/出售 或 全部/求租/求购）
const { callCloud } = require('../../utils/cloud.js');

const CATEGORY_MAP = {
  racket:  { label: '球拍类', emoji: '🏸' },
  ball:    { label: '球类',   emoji: '⚽' },
  shoe:    { label: '鞋服',   emoji: '👟' },
  other:   { label: '其他',   emoji: '🎽' }
};

// 一级 tab 配置
const VIEW_TYPE_LIST = [
  { value: 'equipment', label: '器材' },
  { value: 'demand',    label: '求物' }
];

// 二级 tab 配置：按 viewType 给出不同 label，filter 值保持 all/rent/sell 不变
const SECONDARY_TABS = {
  equipment: [
    { label: '全部', filter: 'all'  },
    { label: '出租', filter: 'rent' },
    { label: '出售', filter: 'sell' }
  ],
  demand: [
    { label: '全部', filter: 'all'  },
    { label: '求租', filter: 'rent' },
    { label: '求购', filter: 'sell' }
  ]
};

Page({
  data: {
    // 一级 tab
    viewTypeList: VIEW_TYPE_LIST,
    viewType: 'equipment',          // equipment / demand
    // 二级 tab
    secondaryTabs: SECONDARY_TABS.equipment,
    secondaryIndex: 0,              // 关键：默认选中第 0 个（全部）
    // 搜索
    keyword: '',
    // 列表
    list: [],
    loading: true
  },
  _searchTimer: null,

  onLoad() { this.fetch(); },
  onShow() { if (this.data.list.length > 0) this.fetch(true); },
  onPullDownRefresh() { this.fetch(true).then(() => wx.stopPullDownRefresh()); },
  onUnload() { if (this._searchTimer) clearTimeout(this._searchTimer); },

  // ============ 一级 tab 切换（关键：重置二级 tabIndex 为 0） ============
  onSwitchViewType(e) {
    const viewType = e.currentTarget.dataset.viewtype;
    if (viewType === this.data.viewType) return;
    // 关键：动态渲染对应二级 tab 数组，索引归零
    this.setData({
      viewType,
      secondaryTabs: SECONDARY_TABS[viewType],
      secondaryIndex: 0,
      list: []
    });
    this.fetch();
  },

  // ============ 二级 tab 切换 ============
  onSwitchSecondary(e) {
    const idx = e.currentTarget.dataset.idx;
    if (idx === this.data.secondaryIndex) return;
    this.setData({ secondaryIndex: idx, list: [] });
    this.fetch();
  },

  // ============ 搜索 ============
  onSearchInput(e) {
    const keyword = e.detail.value;
    this.setData({ keyword });
    // 关键：300ms 防抖
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.fetch(), 300);
  },
  onSearchConfirm() {
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this.fetch();
  },
  onClearKeyword() {
    this.setData({ keyword: '' });
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this.fetch();
  },
  onCancelSearch() {
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this.setData({ keyword: '' });
    this.fetch();
  },

  // ============ 拉取列表 ============
  async fetch(silent) {
    if (!silent) this.setData({ loading: true });
    // 关键：从二级 tab 直接取出当前 filter
    const { viewType, secondaryIndex, secondaryTabs, keyword } = this.data;
    const filter = secondaryTabs[secondaryIndex].filter;
    try {
      if (viewType === 'equipment') {
        const resp = await callCloud('equipment', {
          type: 'list',
          tradeType: filter === 'all' ? undefined : filter,
          keyword: keyword || undefined
        });
        if (resp.result && resp.result.success) {
          // 关键：不用 { ...e, ... } 对象 spread → Babel helper 问题,改用 Object.assign
          const list = (resp.result.data.list || []).map((e) => {
            const isSell = e.tradeType === 'sell';
            return Object.assign({}, e, {
              categoryLabel: (CATEGORY_MAP[e.category] || {}).label || e.category,
              categoryEmoji: (CATEGORY_MAP[e.category] || {}).emoji || '🎽',
              tradeTypeLabel: isSell ? '出售' : '出租',
              tradeTypeClass: isSell ? 'tag--sell' : 'tag--rent',
              priceText: isSell
                ? `¥${e.salePrice || 0}`
                : (e.pricePerDay > 0 ? `¥${e.pricePerDay}` : '免费'),
              priceUnit: isSell ? '' : '/天',
              isSell: isSell
            });
          });
          this.setData({ list, loading: false });
        } else {
          this.setData({ loading: false });
          wx.showToast({ title: '加载失败', icon: 'none' });
        }
      } else {
        // 需求模式
        const resp = await callCloud('equipment', {
          type: 'listDemands',
          demandType: filter === 'all' ? undefined : filter,
          keyword: keyword || undefined
        });
        if (resp.result && resp.result.success) {
          // 关键：不用 { ...d, ... } 对象 spread → Babel helper 问题,改用 Object.assign
          const list = (resp.result.data.list || []).map((d) => {
            const isWantBuy = d.demandType === 'sell';
            return Object.assign({}, d, {
              categoryLabel: (CATEGORY_MAP[d.category] || {}).label || d.category,
              categoryEmoji: (CATEGORY_MAP[d.category] || {}).emoji || '🎽',
              demandTypeLabel: isWantBuy ? '求购' : '求租',
              demandTypeClass: isWantBuy ? 'tag--sell' : 'tag--rent',
              expectedText: d.expectedPrice > 0
                ? `期望 ¥${d.expectedPrice}${isWantBuy ? '' : '/天'}`
                : '价格可议',
              createdAtText: this._fmt(d.createdAt)
            });
          });
          this.setData({ list, loading: false });
        } else {
          this.setData({ loading: false });
          wx.showToast({ title: '加载失败', icon: 'none' });
        }
      }
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: '调用失败，请看控制台', icon: 'none' });
    }
  },

  _fmt(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  },

  onTapItem(e) { wx.navigateTo({ url: `/pages/equipment/detail?id=${e.currentTarget.dataset.id}` }); },
  onTapPublish() {
    if (this.data.viewType === 'equipment') {
      wx.navigateTo({ url: '/pages/equipment/publish' });
    } else {
      wx.navigateTo({ url: '/pages/equipment/demand-publish' });
    }
  }
});
