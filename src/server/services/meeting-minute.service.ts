import { prisma } from "@/server/db/client";
import type { MeetingMinuteInput } from "@/server/validators/meeting-minute";
import { logActivity } from "./activity-log.service";

export async function createMeetingMinute(data: MeetingMinuteInput, userId: string) {
  const meeting = await prisma.meetingMinute.create({
    data: {
      meetingDate: new Date(data.meetingDate),
      status: data.status,
      notes: data.notes || null,
      projectId: data.projectId,
      createdById: userId,
    },
  });
  await logActivity({ userId, action: "CREATE", entity: "MEETING_MINUTE", entityId: meeting.id });
  return meeting;
}

export async function deleteMeetingMinute(id: string, userId: string) {
  const meeting = await prisma.meetingMinute.delete({ where: { id } });
  await logActivity({ userId, action: "DELETE", entity: "MEETING_MINUTE", entityId: id });
  return meeting;
}
