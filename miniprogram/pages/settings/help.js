// pages/settings/help.js
// 帮助与反馈
//   - 展示常见 FAQ
//   - 提供反馈入口（这里先用「写反馈」弹一个 textarea 弹窗，本地展示；后续可接云函数落库）

const FAQS = [
  {
    q: '怎么发布约球?',
    a: '进入"约球"tab,点击右下角"+"按钮,填写运动项目、时间、地点、需要人数,选填截止时间,发布即可。'
  },
  {
    q: '怎么查看我发起的约球?',
    a: '进入"我的"→"我的约球"tab,即可看到所有你发起的帖子(含已关闭、已过期)。'
  },
  {
    q: '招募截止时间到了会怎样?',
    a: '帖子会自动从约球广场隐藏,只有你自己能在"我的约球"里看到。'
  },
  {
    q: '怎么取消入队?',
    a: '进入帖子详情页,点击底部"取消入队"按钮即可。'
  },
  {
    q: '怎么联系发起人?',
    a: '在帖子详情页的"联系方式"一栏查看,可在群聊/线下联系。'
  },
  {
    q: '怎么删除已发布的帖子?',
    a: '进入"我的"→"我的约球"→ 点开帖子 → 底部"删除帖子"。删除后不可恢复。'
  },
  {
    q: '"运动偏好"有什么用?',
    a: '在"我的"里勾选你喜欢的运动后,约球广场会把这些运动排在分类最前面,默认进入时也会优先展示。'
  }
];

Page({
  data: {
    faqs: FAQS,
    feedbackText: '',
    feedbackVisible: false
  },

  onCopyEmail() {
    wx.setClipboardData({
      data: 'feedback@shiqiu.app',
      success: () => wx.showToast({ title: '邮箱已复制', icon: 'success' })
    });
  },

  onOpenFeedback() {
    // 简化版：弹一个带 textarea 的 modal，让用户写反馈内容（暂时只展示，不上传）
    // 实际项目里这里应该 wx.cloud.callFunction 落库到 feedback 集合
    this.setData({ feedbackVisible: true, feedbackText: '' });
  },

  onFeedbackInput(e) {
    this.setData({ feedbackText: e.detail.value });
  },

  onFeedbackClose() {
    this.setData({ feedbackVisible: false });
  },

  onFeedbackSubmit() {
    const txt = (this.data.feedbackText || '').trim();
    if (!txt) {
      return wx.showToast({ title: '内容不能为空', icon: 'none' });
    }
    // 关键：占位实现 - 真实项目应该 wx.cloud.callFunction 落库
    // 这里只做本地 toast，告诉你"收到了"
    console.log('[feedback]', txt);
    this.setData({ feedbackVisible: false });
    wx.showModal({
      title: '已收到',
      content: '感谢你的反馈,我们会尽快查看(本演示版本未上传到服务器)',
      showCancel: false,
      confirmText: '好的'
    });
  }
});
