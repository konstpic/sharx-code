#!/bin/sh
set -eu
# Must run inside a disposable container with its own network namespace.
ip netns add sxserver
ip netns add sxclient
trap 'ip netns del sxserver; ip netns del sxclient' EXIT
ip link add sx0 type veth peer name sx1
ip link set sx0 netns sxserver
ip link set sx1 netns sxclient
ip -n sxserver addr add 10.203.0.1/24 dev sx0
ip -n sxclient addr add 10.203.0.2/24 dev sx1
ip -n sxserver -6 addr add fd42:203::1/64 dev sx0 nodad
ip -n sxclient -6 addr add fd42:203::2/64 dev sx1 nodad
ip -n sxserver link set sx0 up
ip -n sxclient link set sx1 up
ip -n sxserver link set lo up
ip -n sxclient link set lo up
ip netns exec sxserver env SHARX_QOS_KERNEL_TEST=1 /tests/qos.test -test.run TestKernelTrafficLimits -test.v
