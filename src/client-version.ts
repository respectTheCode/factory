import { FACTORY_API_VERSION } from "./api-version";

declare const FACTORY_CLIENT_REVISION: string | undefined;

export const CLIENT_REVISION =
  typeof FACTORY_CLIENT_REVISION === "string" ? FACTORY_CLIENT_REVISION : "dev";

export function clientVersionText(): string {
  return `Factory client revision: ${CLIENT_REVISION}\nFactory API version: ${FACTORY_API_VERSION}`;
}
