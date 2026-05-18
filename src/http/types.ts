import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Express-style request object.
 *
 * Extends Node's IncomingMessage with parsed routing data and a small
 * surface of read helpers.
 */
export interface Request extends IncomingMessage {
  /** Path parameters captured by the matched route ("/users/:id" -> { id }). */
  params: Record<string, string>;
  /** Parsed query-string parameters. */
  query: Record<string, string>;
  /** The pathname portion of the URL, without query string. */
  path: string;
  /** The path prefix this request was mounted under (set by sub-routers). */
  baseUrl: string;
  /** The full original request URL, before any sub-router stripping. */
  originalUrl: string;

  /** Return a request header value (case-insensitive). Alias of header(). */
  get(name: string): string | undefined;
  /** Return a request header value (case-insensitive). */
  header(name: string): string | undefined;
}

/**
 * Express-style response object.
 *
 * Extends Node's ServerResponse with chainable helpers for the most
 * common reply shapes (status, json, send, redirect, etc).
 */
export interface Response extends ServerResponse {
  /** Set the status code. Chainable: res.status(201).json({...}). */
  status(code: number): this;
  /** Send a status code with its default text body. */
  sendStatus(code: number): this;

  /** Send a JSON response. Sets Content-Type if not already set. */
  json(body: unknown): this;
  /**
   * Send a response body. Strings/Buffers/streams are sent as-is;
   * any other value is JSON-stringified.
   */
  send(body?: unknown): this;

  /** Set the Content-Type header. Accepts a full type or a shorthand ("json", "html", "text"). */
  type(mime: string): this;

  /** Set a response header. Chainable. */
  set(name: string, value: number | string | readonly string[]): this;
  /** Alias for set(). */
  header(name: string, value: number | string | readonly string[]): this;

  /** Redirect the client. Defaults to a 302. */
  redirect(url: string): this;
  redirect(status: number, url: string): this;
}
