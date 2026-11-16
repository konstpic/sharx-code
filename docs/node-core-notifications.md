# Worker core notifications

Enable **Settings → Telegram → Notifications → Node core failures** to send
Xray, Telemt and AmneziaWG failure/recovery alerts to the bot's existing
administrator chats. The bot must already be enabled and configured. The new
option is off by default (`tgBotNodeCoreNotify=false`); upgrading does not
subscribe administrators automatically.

Only cores required by enabled inbounds assigned to an enabled node are
monitored. Two consecutive stopped/error observations open an incident and
send one alert. Two consecutive running observations close it and send one
recovery message. Repeated observations do not repeat the alert.

An unreachable worker uses the existing node availability notifications and
does not count as a core failure. Unknown core states break consecutive-check
streaks. Disabling/removing a node or no longer configuring a core clears its
incident without a recovery notification. Incident tracking is in memory and
starts fresh when the panel restarts. Monitoring does not change the existing
automatic core recovery policy.
