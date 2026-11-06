import outlookProxyHandler from "./proxy";

const widget = {
  api: "https://graph.microsoft.com/v1.0/{endpoint}",
  proxyHandler: outlookProxyHandler,
};

export default widget;
