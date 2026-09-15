"use client";

import { useEffect, useState } from "react";

const CONTENT_PREFERENCE_KEY = "capture.notification.includeContent.v1";

function applicationServerKey(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const raw = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

export function NotificationSettings() {
  const supported = typeof window !== "undefined" && "serviceWorker" in navigator
    && "PushManager" in window && "Notification" in window;
  const [enabled, setEnabled] = useState(false);
  const [includeContent, setIncludeContent] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem(CONTENT_PREFERENCE_KEY) !== "false";
    } catch {
      return true;
    }
  });
  const [status, setStatus] = useState(supported ? "檢查中" : "此裝置不支援 Web Push");

  useEffect(() => {
    if (!supported) return;
    void navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => {
        setEnabled(Boolean(subscription));
        setStatus(subscription ? "手機提醒已啟用" : "手機提醒尚未啟用");
      })
      .catch(() => setStatus("無法讀取通知狀態"));
  }, [supported]);

  async function saveSubscription(subscription: PushSubscription, withContent = includeContent) {
    const response = await fetch("/api/notifications/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subscription: subscription.toJSON(), includeContent: withContent }),
    });
    if (!response.ok) throw new Error("subscription failed");
  }

  async function enable() {
    setStatus("啟用中");
    try {
      const permission = Notification.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();
      if (permission !== "granted") throw new Error("permission denied");
      const keyResponse = await fetch("/api/notifications/public-key", { cache: "no-store" });
      if (!keyResponse.ok) throw new Error("push not configured");
      const { publicKey } = await keyResponse.json() as { publicKey: string };
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription()
        ?? await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(publicKey),
        });
      await saveSubscription(subscription);
      setEnabled(true);
      setStatus("手機提醒已啟用");
    } catch {
      setStatus(Notification.permission === "denied" ? "通知權限已被拒絕" : "手機提醒啟用失敗");
    }
  }

  async function disable() {
    setStatus("關閉中");
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/notifications/subscriptions", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setEnabled(false);
      setStatus("手機提醒尚未啟用");
    } catch {
      setStatus("無法關閉手機提醒");
    }
  }

  async function changePrivacy(next: boolean) {
    setIncludeContent(next);
    try {
      window.localStorage.setItem(CONTENT_PREFERENCE_KEY, String(next));
    } catch {
      // The server setting can still be updated for the current subscription.
    }
    if (!enabled) return;
    const subscription = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    if (subscription) await saveSubscription(subscription, next);
  }

  return (
    <section className="notificationSettings">
      <strong>提醒</strong>
      <p>每天約 20:00 提醒最近的續；週日也提醒回顧最近七天。</p>
      <label>
        <input type="checkbox" checked={includeContent} onChange={(event) => void changePrivacy(event.target.checked)} />
        在鎖定畫面顯示內容
      </label>
      <button type="button" disabled={!supported} onClick={() => void (enabled ? disable() : enable())}>
        {enabled ? "關閉手機提醒" : "啟用手機提醒"}
      </button>
      <small role="status">{status}</small>
    </section>
  );
}
