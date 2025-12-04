// server/zoom.ts
import axios from "axios";

// Zoom API configuration from environment variables
const ZOOM_ACCOUNT_ID = process.env.ZOOM_ACCOUNT_ID || "";
const ZOOM_CLIENT_ID = process.env.ZOOM_CLIENT_ID || "";
const ZOOM_CLIENT_SECRET = process.env.ZOOM_CLIENT_SECRET || "";

export interface ZoomMeetingLinks {
  hostStartUrl: string; // URL for tutor to start meeting as host
  participantJoinUrl: string; // URL for student to join meeting
  meetingId: string;
  meetingPassword?: string;
}

/**
 * Get Zoom OAuth access token using Server-to-Server OAuth
 */
async function getZoomAccessToken(): Promise<string> {
  if (!ZOOM_ACCOUNT_ID || !ZOOM_CLIENT_ID || !ZOOM_CLIENT_SECRET) {
    throw new Error(
      "Zoom API credentials not configured. Please set ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, and ZOOM_CLIENT_SECRET environment variables."
    );
  }

  try {
    const tokenUrl = `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ZOOM_ACCOUNT_ID}`;

    const response = await axios.post(
      tokenUrl,
      {},
      {
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`
          ).toString("base64")}`,
        },
      }
    );

    return response.data.access_token;
  } catch (error: any) {
    console.error("Error getting Zoom access token:", error.response?.data || error.message);
    throw new Error("Failed to authenticate with Zoom API");
  }
}

/**
 * Create an instant Zoom meeting
 * @param topic - Meeting topic/title
 * @param duration - Duration in minutes
 * @param tutorEmail - Tutor's email (optional, for meeting host info)
 * @returns Object with host start URL and participant join URL
 */
export async function createZoomMeeting(
  topic: string,
  duration: number,
  tutorEmail?: string
): Promise<ZoomMeetingLinks> {
  try {
    const accessToken = await getZoomAccessToken();

    // Create instant meeting (no fixed time, available immediately)
    const meetingData = {
      topic,
      type: 1, // Instant meeting
      duration, // Duration in minutes
      settings: {
        host_video: true,
        participant_video: true,
        join_before_host: false, // Students can't join until tutor starts
        waiting_room: false, // Disabled for easier access
        mute_upon_entry: false,
        auto_recording: "none", // No automatic recording
        approval_type: 2, // No registration required
      },
    };

    // Use "me" as userId for Server-to-Server OAuth app
    const response = await axios.post(
      "https://api.zoom.us/v2/users/me/meetings",
      meetingData,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const meeting = response.data;

    return {
      hostStartUrl: meeting.start_url, // Tutor uses this to start as host
      participantJoinUrl: meeting.join_url, // Student uses this to join
      meetingId: meeting.id.toString(),
      meetingPassword: meeting.password,
    };
  } catch (error: any) {
    console.error(
      "Error creating Zoom meeting:",
      error.response?.data || error.message
    );

    if (error.response?.status === 401) {
      throw new Error(
        "Zoom API authentication failed. Please check your credentials."
      );
    }

    throw new Error(
      error.response?.data?.message ||
        "Failed to create Zoom meeting. Please try again."
    );
  }
}

/**
 * Delete a Zoom meeting
 * @param meetingId - The Zoom meeting ID
 */
export async function deleteZoomMeeting(meetingId: string): Promise<void> {
  try {
    const accessToken = await getZoomAccessToken();

    await axios.delete(`https://api.zoom.us/v2/meetings/${meetingId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    console.log(`Zoom meeting ${meetingId} deleted successfully`);
  } catch (error: any) {
    console.error(
      "Error deleting Zoom meeting:",
      error.response?.data || error.message
    );
    // Don't throw error, just log it - meeting deletion is not critical
  }
}

/**
 * Check if Zoom is configured
 */
export function isZoomConfigured(): boolean {
  return !!(ZOOM_ACCOUNT_ID && ZOOM_CLIENT_ID && ZOOM_CLIENT_SECRET);
}

/**
 * Get Zoom configuration status
 */
export function getZoomStatus() {
  return {
    configured: isZoomConfigured(),
    message: isZoomConfigured()
      ? "Zoom API is configured and ready"
      : "Zoom API not configured. Set ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, and ZOOM_CLIENT_SECRET.",
  };
}
