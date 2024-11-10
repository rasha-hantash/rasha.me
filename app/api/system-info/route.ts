// app/api/system-info/route.ts
import { NextRequest, NextResponse } from 'next/server';
import os from 'os';

export async function GET(req: NextRequest) {
    // Get IP from various headers
    const forwarded = req.headers.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0] : '127.0.0.1';
    
    // Get user agent
    const userAgent = req.headers.get('user-agent');
    // Get system stats
    const systemStats = getSystemStats();
    
    // Parse user agent for device info
    const device = {
        isMobile: /Mobile|Android|iPhone/i.test(userAgent || ''),
        browser: getClientBrowser(userAgent || ''),
        os: getClientOS(userAgent || ''),
        arch: getClientArchitecture(userAgent || ''),
    };

    return NextResponse.json({
        ip,
        timestamp: new Date().toISOString(),
        userAgent,
        device,
        hostname: req.headers.get('host'),
        protocol: req.headers.get('x-forwarded-proto') || 'http',
        // language: req.headers.get('accept-language'),
        percentageUsed: systemStats.memory.percentage.toFixed(1)
    });
}

function getClientBrowser(ua: string): string {
    if (ua.includes('Firefox')) return 'Firefox';
    if (ua.includes('Chrome')) return 'Chrome';
    if (ua.includes('Safari')) return 'Safari';
    if (ua.includes('Edge')) return 'Edge';
    if (ua.includes('Opera')) return 'Opera';
    return 'Unknown';
}

function getClientOS(ua: string): string {
    if (ua.includes('Windows')) return 'Windows';
    if (ua.includes('Mac OS')) return 'MacOS';
    if (ua.includes('Linux')) return 'Linux';
    if (ua.includes('Android')) return 'Android';
    if (ua.includes('iOS')) return 'iOS';
    return 'Unknown';
}

interface SystemStats {
    memory: {
      percentage: number;
    };

  }

function getSystemStats(): SystemStats {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    
    // Get heap statistics
    // const heapStats = v8.getHeapStatistics();
    
    // Get process memory usage
    // const processMemory = process.memoryUsage();
  
    return {
      memory: {
        percentage: (usedMem / totalMem) * 100
      },
    //   process: {
    //     heapUsed: processMemory.heapUsed,
    //     heapTotal: processMemory.heapTotal,
    //     external: processMemory.external,
    //     arrayBuffers: processMemory.arrayBuffers || 0
    //   }
    };
  }
  

function getClientArchitecture(ua: string): string {
    // Check for ARM devices
    if (ua.includes('aarch64') || ua.includes('arm64')) {
      return 'ARM64';
    }
    // Check for x86_64 devices
    if (ua.includes('x86_64') || ua.includes('x64')) {
      return 'x86_64';
    }
    // Check for 32-bit devices
    if (ua.includes('x86') || ua.includes('i386')) {
      return 'x86';
    }
    return 'Unknown';
  }