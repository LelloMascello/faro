import { describe, it } from "vitest";

import widget from "./widget";

import { expectWidgetConfigShape } from "test-utils/widget-config";

describe("widgets/gmail/widget", () => {
  it("exports a valid widget config", () => {
    expectWidgetConfigShape(widget);
  });
});
