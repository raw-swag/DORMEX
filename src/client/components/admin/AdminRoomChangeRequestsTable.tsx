import React from 'react';
import { Repeat, CheckCircle, XCircle } from 'lucide-react';

export interface AdminRoomChangeRequestsTableProps {
  requests: any[];
  onReview: (requestId: string, decision: 'APPROVED' | 'REJECTED') => void;
}

export const AdminRoomChangeRequestsTable: React.FC<AdminRoomChangeRequestsTableProps> = ({
  requests,
  onReview,
}) => {
  return (
    <div className="bg-white p-5 rounded-xl border border-[#DFE3E5] shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-[#DFE3E5] pb-3">
        <div>
          <h2 className="text-xs font-bold text-[#07203C] uppercase tracking-wider flex items-center gap-2">
            <Repeat className="w-4 h-4 text-[#016A62]" />
            Official 48-Hour Room-Change Requests Inbox
          </h2>
          <p className="text-[11px] text-[#44474D] mt-0.5">
            Review and approve or reject atomic seat transfers requested during the 48-hour post-allocation period.
          </p>
        </div>
        <span className="text-xs font-bold bg-[#FAF4E6] text-[#9C7A2E] border border-[#D4B779] px-2.5 py-1 rounded">
          {requests.length} Total Requests
        </span>
      </div>

      {requests.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-[#181C1E]">
            <thead className="bg-[#F0F4F6] text-[11px] uppercase font-bold text-[#44474D] border-b border-[#DFE3E5] tracking-wider">
              <tr>
                <th className="py-2.5 px-4">Student</th>
                <th className="py-2.5 px-4">Current Allocation</th>
                <th className="py-2.5 px-4">Target Room</th>
                <th className="py-2.5 px-4">Reason</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4 text-right">Administrative Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#DFE3E5]">
              {requests.map((r: any) => (
                <tr key={r.id} className="hover:bg-[#F8F9FA] transition-colors">
                  <td className="py-3 px-4 font-semibold text-[#07203C]">
                    {r.student_name}
                    <div className="text-[10px] text-[#74777F] font-normal">{r.student_college_id}</div>
                  </td>
                  <td className="py-3 px-4 font-mono font-bold text-[#001E2F]">
                    {r.current_seat_id || 'None'}
                  </td>
                  <td className="py-3 px-4 font-semibold text-[#016A62]">
                    Room {r.target_room_number}
                  </td>
                  <td className="py-3 px-4 text-[#44474D] max-w-xs truncate" title={r.reason}>
                    {r.reason}
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        r.status === 'APPROVED'
                          ? 'bg-[#EBFDF9] text-[#016A62]'
                          : r.status === 'REJECTED'
                          ? 'bg-[#FEECEC] text-[#BA1A1A]'
                          : 'bg-[#FAF4E6] text-[#9C7A2E]'
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right space-x-1.5">
                    {r.status === 'PENDING' ? (
                      <>
                        <button
                          onClick={() => onReview(r.id, 'APPROVED')}
                          className="px-2.5 py-1 text-[11px] font-bold text-white bg-[#016A62] hover:bg-[#00514B] rounded transition-colors inline-flex items-center gap-1"
                        >
                          <CheckCircle className="w-3 h-3" />
                          Approve
                        </button>
                        <button
                          onClick={() => onReview(r.id, 'REJECTED')}
                          className="px-2.5 py-1 text-[11px] font-bold text-[#BA1A1A] bg-[#FEECEC] hover:bg-[#FFDAD6] rounded transition-colors inline-flex items-center gap-1"
                        >
                          <XCircle className="w-3 h-3" />
                          Reject
                        </button>
                      </>
                    ) : (
                      <span className="text-[11px] text-[#74777F] italic">Reviewed</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-8 text-xs text-[#74777F]">
          No room-change requests filed in the current 48-hour cycle window.
        </div>
      )}
    </div>
  );
};
