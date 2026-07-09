import 'package:flutter/widgets.dart';

abstract final class LiveMonitorKeys {
  static const activeSessionsBadge = Key('live_monitor.active_sessions_badge');
  static const assignedFilter = Key('live_monitor.assigned_filter');
  static const channelFilter = Key('live_monitor.channel_filter');
  static const monitorGrid = Key('live_monitor.monitor_grid');
  static const orderFilter = Key('live_monitor.order_filter');
  static const operationsHeader = Key('live_monitor.operations_header');
  static const severityFilter = Key('live_monitor.severity_filter');
  static const sortMode = Key('live_monitor.sort_mode');
  static const statusFilter = Key('live_monitor.status_filter');

  static Key sessionCard(String sessionId) =>
      Key('live_monitor.session_card.$sessionId');

  static Key sessionOpenChatButton(String sessionId) =>
      Key('live_monitor.session_open_chat_button.$sessionId');

  static Key sessionJoinHumanButton(String sessionId) =>
      Key('live_monitor.session_join_human_button.$sessionId');

  static Key sessionHumanMessageField(String sessionId) =>
      Key('live_monitor.session_human_message_field.$sessionId');

  static Key sessionSendHumanMessageButton(String sessionId) =>
      Key('live_monitor.session_send_human_message_button.$sessionId');

  static Key sessionResumeAiButton(String sessionId) =>
      Key('live_monitor.session_resume_ai_button.$sessionId');
}
