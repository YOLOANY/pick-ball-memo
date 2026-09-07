// pages/equipment/my.js
// 我的器材：我的租借 / 我买到的 / 我发布的 / 我发布的需求
const { callCloud } = require('../../utils/cloud.js');

const BORROW_STATUS = { pending: '待确认', confirmed: '已确认', returned: '已归还', cancelled: '已取消' };
const BUY_STATUS    = { pending: '待确认', confirmed: '已确认', completed: '已完成', cancelled: '已取消' };
const EQUIP_STATUS  = { available: '可购买/可租借', rented: '已出租', sold: '已售出', offline: '已下架' };
const DEMAND_STATUS = { open: '招募中', closed: '已关闭' };

const CATEGORY_MAP = {
  racket: { label: '球拍类', emoji: '🏸' },
  ball:   { label: '球类',   emoji: '⚽' },
  shoe:   { label: '鞋服',   emoji: '👟' },
  other:  { label: '其他',   emoji: '🎽' }
};

Page({
  data: {
    tab: 'borrows',            // borrows / buys / published / demands
    list: [],
    loading: false
  },
  onLoad(query) {
    if (query && ['borrows', 'buys', 'published', 'demands'].includes(query.tab)) {
      this.setData({ tab: query.tab });
    }
    this.fetch();
  },
  onShow() { if (this.data.list.length > 0 || this.data.tab) this.fetch(true); },
  onPullDownRefresh() { this.fetch(true).then(() => wx.stopPullDownRefresh()); },

  onSwitchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.tab) return;
    this.setData({ tab, list: [] });
    this.fetch();
  },

  async fetch(silent) {
    if (!silent) this.setData({ loading: true });
    const tab = this.data.tab;
    const type = tab === 'borrows' ? 'myBorrows'
               : tab === 'buys'    ? 'myBuys'
               : tab === 'demands' ? 'myDemands'
               : 'myPublished';
    try {
      const resp = await callCloud('equipment', { type });
      if (resp.result && resp.result.success) {
        // 关键：不用 { ...o, ... } 对象 spread → Babel helper 问题,改用 Object.assign
        const statusMap = tab === 'borrows' ? BORROW_STATUS
                       : tab === 'buys'    ? BUY_STATUS
                       : tab === 'demands' ? DEMAND_STATUS
                       : EQUIP_STATUS;
        const list = (resp.result.data.list || []).map((o) => {
          const cat = (CATEGORY_MAP[o.category] || {});
          return Object.assign({}, o, {
            statusLabel: statusMap[o.status] || o.status || '',
            createdAtText: this._fmt(o.createdAt),
            categoryLabel: cat.label || o.category || '',
            categoryEmoji: cat.emoji || '🎽'
          });
        });
        this.setData({ list, loading: false });
      } else {
        this.setData({ loading: false });
        wx.showToast({ title: '加载失败', icon: 'none' });
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
  onPublish() { wx.navigateTo({ url: '/pages/equipment/publish' }); },
  onPublishDemand() { wx.navigateTo({ url: '/pages/equipment/demand-publish' }); },

  async onCancel(e) {
    const { id } = e.currentTarget.dataset;
    const tab = this.data.tab;
    const isBuy = tab === 'buys';
    const isDemand = tab === 'demands';
    const confirmed = await new Promise((r) => wx.showModal({
      title: '提示',
      content: isBuy ? '确认取消该购买？' : (isDemand ? '确认关闭该求物？' : '确认取消该租借？'),
      success: (res) => r(res.confirm)
    }));
    if (!confirmed) return;
    const type = isBuy ? 'cancelBuy' : (isDemand ? 'closeDemand' : 'cancel');
    try {
      const resp = await callCloud('equipment', { type, id });
      if (resp.result && resp.result.success) {
        wx.showToast({ title: isDemand ? '已关闭' : '已取消', icon: 'success' });
        this.fetch(true);
      } else {
        wx.showToast({ title: (resp.result && resp.result.errMsg) || '操作失败', icon: 'none' });
      }
    } catch (e) { wx.showToast({ title: '网络异常', icon: 'none' }); }
  }
});
