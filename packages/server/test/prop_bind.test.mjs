import { test } from "node:test";
import assert from "node:assert/strict";
import { renderComponent } from "../dist/index.js";

function makeProbe(buildView) {
  return {
    name: "Probe",
    create() {
      return {
        actions: {},
        buildView,
        serializeState: () => ({}),
        restoreState: () => {},
      };
    },
  };
}

test("prop bind on input value renders value attribute + marker", () => {
  const { html } = renderComponent(
    makeProbe(() => ({
      kind: "element",
      tag: "input",
      attrs: { value: { kind: "prop", get: () => "hello" } },
      events: {},
      children: [],
    }))
  );
  assert.ok(html.includes('value="hello"'));
  assert.ok(html.includes("data-rift-prop-value"));
});

test("prop bind on checked: true renders the boolean attribute, omits when false", () => {
  const { html: htmlOn } = renderComponent(
    makeProbe(() => ({
      kind: "element",
      tag: "input",
      attrs: {
        type: "checkbox",
        checked: { kind: "prop", get: () => true },
      },
      events: {},
      children: [],
    }))
  );
  assert.ok(htmlOn.includes('checked=""'));
  assert.ok(htmlOn.includes("data-rift-prop-checked"));

  const { html: htmlOff } = renderComponent(
    makeProbe(() => ({
      kind: "element",
      tag: "input",
      attrs: {
        type: "checkbox",
        checked: { kind: "prop", get: () => false },
      },
      events: {},
      children: [],
    }))
  );
  assert.ok(!htmlOff.includes("checked"));
  assert.ok(!htmlOff.includes("data-rift-prop-checked"));
});

test("prop bind escapes string values for the HTML attribute", () => {
  const { html } = renderComponent(
    makeProbe(() => ({
      kind: "element",
      tag: "input",
      attrs: { value: { kind: "prop", get: () => 'a"&<b' } },
      events: {},
      children: [],
    }))
  );
  assert.ok(html.includes('value="a&quot;&amp;&lt;b"'));
});
