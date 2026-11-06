import gmailProxyHandler from "./proxy";

const widget = {
  api: "https://gmail.googleapis.com/gmail/v1/{endpoint}",
  proxyHandler: gmailProxyHandler,
};

export default widget;
