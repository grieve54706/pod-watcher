#!/usr/bin/env node

import figlet from 'figlet';
import gradient from 'gradient-string';
import { input, confirm } from '@inquirer/prompts';
import shell from 'shelljs';
import chalk from 'chalk';


async function main() {

    console.log(gradient.retro(figlet.textSync('Pod Watcher')));

    console.log('Welcome to Pod Watcher! You can input the name of the pod you want to monitor for peak CPU and memory usage.')

    const selectedPods = (await input({ message: "Enter pod names (separated by ','): ", required: true })).split(',');

    const podNames = [];
    const { stdout } = shell.exec('kubectl get pods -o jsonpath={..metadata.name}', { silent: true })
    for (const podName of stdout.split(' ')) {
        for (const pod of selectedPods) {
            if (podName.startsWith(pod)) {
                podNames.push(podName);
            }
        }
    }

    console.log(podNames);
    const podPeakCPU = new Map();
    const podPeakMemory = new Map();
    let cpuJob;
    let memJob;

    if (await confirm({ message: 'Do you want to ' + chalk.green('START') + ' to watch these memory usages of pods?', default: true })) {
        addScriptIntoPods(podNames);
        cpuJob = startCollectCPU(podNames, podPeakCPU);
        memJob = startCollectMemory(podNames, podPeakMemory);
    }
    else {
        return;
    }

    console.log('Now you can start your process to monitor the peak CPU and memory usage of the pods. Once your process is complete, you can stop the watcher to review the results.');

    if (await confirm({ message: 'Do you want to ' + chalk.red('STOP') + ' the watcher to view the results?', default: true })) {
        console.log('\nPeak usage of each pod\n');
        const maxPodNameLength = findMaxPodNameLength(podNames);
        const blank = '   ';
        console.log(`${'NAME'.padEnd(maxPodNameLength)} ${blank} CPU(cores) ${blank} MEMORY(bytes)`);
        podNames.forEach(pod => {
            const cpu_usage = formatCPU(podPeakCPU.get(pod));
            const memory_usage = bytesToMB(podPeakMemory.get(pod));
            console.log(`${pod.padEnd(maxPodNameLength)} ${blank} ${cpu_usage.padEnd('CPU(cores)'.length)} ${blank} ${memory_usage}`);
        });
    }

    clearTimeout(cpuJob);
    clearTimeout(memJob);
}

function addScriptIntoPods(podNames) {
    const shellScript = `
cat <<'EOF' > /calc_cpu.sh
    #!/bin/bash
    tstart=\\$(date +%s%6N)
    cstart=\\$(cat /sys/fs/cgroup/cpu.stat | grep usage_usec | awk -F' ' '{print \\$2}')

    sleep 1

    tstop=\\$(date +%s%6N)
    cstop=\\$(cat /sys/fs/cgroup/cpu.stat | grep usage_usec | awk -F' ' '{print \\$2}')

    cpu_usage=\\$(awk -v cstart="\\$cstart" -v cstop="\\$cstop" -v tstart="\\$tstart" -v tstop="\\$tstop" 'BEGIN { printf "%.0f", (cstop - cstart) * 1000 / (tstop - tstart) }')

    echo \\$cpu_usage
EOF

chmod +x /calc_cpu.sh
    `;

    for (const podName of podNames) {
        const command = `kubectl exec -it ${podName} -- bash -c "${shellScript.replace(/"/g, '\\"')}"`;
        shell.exec(command);
    }
}

function startCollectCPU(podNames, podPeakCPU) {
    return setInterval(() => {
        Promise.all(podNames.map(podName => {
            return new Promise((resolve, reject) => {
                collectCPU(podName, podPeakCPU);
                resolve();
            });
        }));
    }, 1000);
}

function collectCPU(podName, podPeakCPU) {
    const { stdout } = shell.exec(`kubectl exec ${podName} -- sh /calc_cpu.sh`, { silent: true })
    const cpu_usage = Number(stdout.trim());
    if (cpu_usage > (podPeakCPU.get(podName) || 0)) {
        podPeakCPU.set(podName, cpu_usage);
    }
}

function startCollectMemory(podNames, podPeakMemory) {
    return setInterval(() => {
        Promise.all(podNames.map(podName => {
            return new Promise((resolve, reject) => {
                collectMemory(podName, podPeakMemory);
                resolve();
            });
        }));
    }, 1000);
}

function collectMemory(podName, podPeakMemory) {
    const { stdout } = shell.exec(`kubectl exec ${podName} -- cat /sys/fs/cgroup/memory.current`, { silent: true })
    const memory_usage = Number(stdout.trim());
    if (memory_usage > (podPeakMemory.get(podName) || 0)) {
        podPeakMemory.set(podName, memory_usage);
    }
}

function findMaxPodNameLength(podNames) {
    return podNames.reduce((a, b) => {
        return a.length > b.length ? a : b;
    }).length;
}

function formatCPU(cpu_usage) {
    return `${parseFloat(cpu_usage).toFixed(0)}m`
}

function bytesToMB(bytes) {
    return `${parseFloat(bytes / (1024 ** 2)).toFixed(0)}Mi`
}

await main();