/**
 * This means the error is caused by wrong configuration of something "configured" by user.
 * e.g. invalid problem judge info.
 */

import { OmittableString, omittableStringToString } from "./omittableString";

export class ConfigurationError extends Error {
  constructor(public originalMessage: OmittableString) {
    super(omittableStringToString(originalMessage));
  }
}

/**
 * This means the task is canceled.
 */
export class CanceledError extends Error {}
