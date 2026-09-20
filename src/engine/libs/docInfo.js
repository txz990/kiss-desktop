// 桌面版适配：浏览器扩展里 getDocInfo 用来读取当前网页标题/描述给 AI 翻译做领域上下文。
// 桌面划词场景没有"网页"，直接返回空对象，下游 genTransReq 读取 .title 等字段不会报错。

export const getDocInfo = () => ({
  title: "",
  description: "",
  summary: "",
});
