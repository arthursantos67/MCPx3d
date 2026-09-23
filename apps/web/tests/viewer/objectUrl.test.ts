import assert from "node:assert/strict";
import { test } from "node:test";

import { BlobUrlTracker, type ObjectUrlFactory } from "../../src/viewer/objectUrl.ts";

function makeFakeFactory(): { factory: ObjectUrlFactory; created: string[]; revoked: string[] } {
  const created: string[] = [];
  const revoked: string[] = [];
  let counter = 0;
  const factory: ObjectUrlFactory = {
    create: (html) => {
      counter += 1;
      const url = `blob:${counter}:${html.length}`;
      created.push(url);
      return url;
    },
    revoke: (url) => {
      revoked.push(url);
    },
  };
  return { factory, created, revoked };
}

test("set() returns a new URL and does not revoke anything the first time", () => {
  const { factory, created, revoked } = makeFakeFactory();
  const tracker = new BlobUrlTracker(factory);

  const url = tracker.set("<html>one</html>");

  assert.equal(url, created[0]);
  assert.deepEqual(revoked, []);
  assert.equal(tracker.get(), url);
});

test("a second set() retains the previous URL until the new frame has loaded", () => {
  const { factory, created, revoked } = makeFakeFactory();
  const tracker = new BlobUrlTracker(factory);

  const first = tracker.set("<html>one</html>");
  const second = tracker.set("<html>two</html>");

  assert.equal(created.length, 2);
  assert.deepEqual(revoked, []);
  assert.equal(tracker.get(), second);

  tracker.markLoaded(second);

  assert.deepEqual(revoked, [first]);
});

test("clear() revokes the current URL and resets to null", () => {
  const { factory, revoked } = makeFakeFactory();
  const tracker = new BlobUrlTracker(factory);
  const url = tracker.set("<html>one</html>");

  tracker.clear();

  assert.deepEqual(revoked, [url]);
  assert.equal(tracker.get(), null);
});

test("clear() revokes a retained URL when replacement never loads", () => {
  const { factory, revoked } = makeFakeFactory();
  const tracker = new BlobUrlTracker(factory);
  const first = tracker.set("<html>one</html>");
  const second = tracker.set("<html>two</html>");

  tracker.clear();

  assert.deepEqual(revoked, [second, first]);
});

test("clear() on an already-empty tracker does not call revoke", () => {
  const { factory, revoked } = makeFakeFactory();
  const tracker = new BlobUrlTracker(factory);

  tracker.clear();

  assert.deepEqual(revoked, []);
});
