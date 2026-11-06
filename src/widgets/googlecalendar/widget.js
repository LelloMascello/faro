import googleCalendarProxyHandler from "./proxy";

const widget = {
  api: "https://www.googleapis.com/calendar/v3/{endpoint}",
  proxyHandler: googleCalendarProxyHandler,

  mappings: {
    completeTask: {
      method: "POST",
      endpoint: "tasks/{tasklist}/{task}/complete",
      segments: ["tasklist", "task"],
    },
  },
};

export default widget;
