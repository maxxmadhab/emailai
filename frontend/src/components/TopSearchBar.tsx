import React from 'react';
import { Search, SlidersHorizontal, RotateCw } from 'lucide-react';

interface TopSearchBarProps {
  query: string;
  onChangeQuery: (q: string) => void;
  onRefresh: () => void;
  refreshing?: boolean;
}

export const TopSearchBar: React.FC<TopSearchBarProps> = ({
  query,
  onChangeQuery,
  onRefresh,
  refreshing = false,
}) => {
  return (
    <div className="w-full flex items-center gap-3 px-6 py-3.5 border-b border-gray-100 bg-white">
      {/* Pill Search Input */}
      <div className="relative flex-1 max-w-xl">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => onChangeQuery(e.target.value)}
          placeholder="Search"
          className="w-full h-9 pl-9 pr-4 rounded-full bg-[#F4F6F5] border-0 text-xs text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#00A340]/50 transition"
        />
      </div>

      {/* Filter and Refresh Icons */}
      <div className="flex items-center gap-1.5 text-gray-400">
        <button
          type="button"
          title="Filter options"
          className="p-1.5 rounded-lg hover:bg-gray-100 hover:text-gray-600 transition cursor-pointer"
        >
          <SlidersHorizontal className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onRefresh}
          title="Refresh emails"
          className={`p-1.5 rounded-lg hover:bg-gray-100 hover:text-gray-600 transition cursor-pointer ${
            refreshing ? 'animate-spin text-[#00A340]' : ''
          }`}
        >
          <RotateCw className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
