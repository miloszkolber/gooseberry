import type { Attachment } from "svelte/attachments";

export interface MewaBehavior<State = unknown, Options = unknown> {
  readonly name: string;
  enhance(root: ParentNode, options?: Options): State | void;
  destroy?(root: ParentNode, state?: State): void;
}

export declare function mewa<State = unknown, Options = unknown>(
  behavior: MewaBehavior<State, Options>,
  options?: Options
): Attachment<HTMLElement>;

export { mewa as attachBehavior };
