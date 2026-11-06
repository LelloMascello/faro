import { describe, expect, it } from "vitest";

import widget from "./widget";

import { expectWidgetConfigShape } from "test-utils/widget-config";

describe("widgets/googlecalendar/widget", () => {
  it("exports a valid widget config with POST completeTask mapping", () => {
    expectWidgetConfigShape(widget);
    expect(widget.mappings.completeTask).toEqual({
      method: "POST",
      endpoint: "tasks/{tasklist}/{task}/complete",
      segments: ["tasklist", "task"],
    });
  });
});
