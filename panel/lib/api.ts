import axios, { type AxiosError } from "axios";
import Qs from "qs";

const api = axios.create({
  withCredentials: true,
});

api.defaults.headers.post["Content-Type"] =
  "application/x-www-form-urlencoded; charset=UTF-8";
api.defaults.headers.common["X-Requested-With"] = "XMLHttpRequest";

api.interceptors.request.use(
  (config) => {
    if (config.data === undefined || config.data === null) {
      return config;
    }
    if (config.data instanceof FormData) {
      if (config.headers) {
        config.headers["Content-Type"] = "multipart/form-data";
      }
    } else if (
      config.headers &&
      config.headers["Content-Type"] === "application/json"
    ) {
      config.data = JSON.stringify(config.data);
    } else {
      config.data = Qs.stringify(config.data, { arrayFormat: "repeat" });
    }
    return config;
  },
  (err) => Promise.reject(err)
);

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      if (typeof window !== "undefined") {
        window.location.reload();
      }
    }
    // A refusal by access control (403) carries the usual `{success:false,msg}` body. Resolving it lets every existing
    // `if (!r.success) toast.error(r.msg)` show the reason instead of ending in an unhandled promise rejection.
    if (
      error.response?.status === 403 &&
      error.response.data &&
      typeof error.response.data === "object" &&
      (error.response.data as { success?: unknown }).success === false
    ) {
      return Promise.resolve(error.response);
    }
    return Promise.reject(error);
  }
);

export type Msg<T = unknown> = { success: boolean; msg: string; obj: T };

export async function getJson<T = unknown>(url: string) {
  const { data } = await api.get<Msg<T>>(url);
  return data;
}

export async function postJson<T = unknown>(
  url: string,
  body?: unknown,
  contentTypeJson?: boolean
) {
  const { data } = await api.post<Msg<T>>(url, body ?? {}, {
    headers: contentTypeJson
      ? { "Content-Type": "application/json" }
      : undefined,
  });
  return data;
}

export { api };
