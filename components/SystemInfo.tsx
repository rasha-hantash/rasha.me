// components/SystemInfo.tsx
'use client';

import { useEffect, useState } from 'react';

interface SystemInfoData {
    ip: string;
    device: {
        isMobile: boolean;
        browser: string;
        os: string;
    };
    hostname: string;
    protocol: string;
    language: string;
    timestamp: string;
    percentageUsed: string;
}

export default function SystemInfo() {
    const [systemInfo, setSystemInfo] = useState<SystemInfoData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchSystemInfo() {
            try {
                const response = await fetch('/api/system-info');
                const data = await response.json();
                setSystemInfo(data);
            } catch (error) {
                console.error('Failed to fetch system info:', error);
            } finally {
                setLoading(false);
            }
        }

        fetchSystemInfo();
    }, []);

    if (loading) {
        return (
            <div className="flex justify-between text-xs font-mono border-b border-[#ffb000] pb-4 mb-8">
                <div>ROBCO INDUSTRIES UNIFIED OPERATING SYSTEM</div>
                <div className="text-right">
                    <div>{">"}LOADING SYSTEM INFO...</div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex justify-between text-xs font-mono border-b border-[#ffb000]  mb-8">
            <div>
                ROBCO INDUSTRIES UNIFIED OPERATING SYSTEM
            </div>
            <div className="flex gap-x-4 text-right">
                <div>{">"}SYSTEM:{systemInfo?.device.os || 'UNKNOWN'}</div>
                <div>{">"}BROWSER:{systemInfo?.device.browser || 'VISITOR'}</div>
                {/* <div>{">"} DOMAIN:{systemInfo?.hostname || 'terminal.local'}</div> */}
                <div>{">"}MEMORY:{systemInfo?.percentageUsed}%</div>
                <div>{">"}IP ADDR:{systemInfo?.ip || '127.0.0.1'}</div>
                <div>{">"}PROTOCOL:{systemInfo?.protocol?.toUpperCase() || 'HTTP'}</div>
                <div className="animate-pulse">{">"}INTERNWEB: CONNECTED</div>
            </div>
        </div>
    );
}