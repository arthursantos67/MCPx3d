/**
 * Blob-URL lifecycle for the sandboxed preview iframe (PRD §10.3/§11.4,
 * Issue #28). `ObjectUrlFactory` is injected so `BlobUrlTracker` is
 * unit-testable with `node --test` against a fake registry -- there is no
 * real `URL.createObjectURL`/Blob registry outside a browser.
 */

export interface ObjectUrlFactory {
  create(html: string): string;
  revoke(url: string): void;
}

export const browserObjectUrlFactory: ObjectUrlFactory = {
  create: (html) => URL.createObjectURL(new Blob([html], { type: "text/html" })),
  revoke: (url) => URL.revokeObjectURL(url),
};

/**
 * Tracks the single current Blob URL for rendered standalone HTML. `set`
 * only revokes the *previous* URL, after the new one has already replaced it
 * (PRD §10.3's "prior Blob URL is revoked after replacement") -- revoking
 * the old URL first would blank the iframe for a frame while the new one
 * loads.
 */
export class BlobUrlTracker {
  private current: string | null = null;
  private retired: string[] = [];
  private readonly factory: ObjectUrlFactory;

  constructor(factory: ObjectUrlFactory) {
    this.factory = factory;
  }

  set(html: string): string {
    const next = this.factory.create(html);
    const previous = this.current;
    this.current = next;
    if (previous) this.retired.push(previous);
    return next;
  }

  markLoaded(url: string): void {
    if (url !== this.current) return;
    for (const retired of this.retired) this.factory.revoke(retired);
    this.retired = [];
  }

  clear(): void {
    if (this.current) this.factory.revoke(this.current);
    for (const retired of this.retired) this.factory.revoke(retired);
    this.retired = [];
    this.current = null;
  }

  get(): string | null {
    return this.current;
  }
}
