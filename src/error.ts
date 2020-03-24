/**
 * This means the error is caused by wrong configuration of something "configured" by user.
 * e.g. invalid problem judge info.
 */

export class ConfigurationError extends Error {}

/**
 * This means the task is canceled.
 */
export class CanceledError extends Error {}
