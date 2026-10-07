package rbac

import "strings"

// Auth marks a route that needs a signed-in, enabled user but no particular permission: page shells, the user's own
// account (password, sessions, API tokens, UI preferences) and endpoints that redact their answer by permission inside the
// handler.
var Auth = []string{}

// routes maps "METHOD /full/path/pattern" (path as registered in Gin, without the secret base path) to the permissions a
// caller must hold, all of them ("a|b" inside one entry means any of the alternatives). A route that is missing here is
// reachable only by administrators: access is denied by default, so a new endpoint cannot silently be open.
//
// Keep the table next to the permission catalogue: adding an endpoint means deciding its permission, and a test fails
// until every registered route has an entry and every entry has a route.
var routes = map[string][]string{
	// ----- shell, account, utilities (any signed-in user) -----
	"GET /panel/":                               Auth,
	"GET /panel/api/api-docs/markdown":          Auth,
	"POST /panel/setting/all":                   Auth, // sensitive fields are removed in the handler unless settings:read
	"POST /panel/setting/defaultSettings":       Auth,
	"POST /panel/setting/updateUser":            Auth, // own login and password, old credentials required
	"POST /panel/setting/sessions/list":         Auth, // own sessions
	"POST /panel/setting/sessions/revoke":       Auth,
	"POST /panel/setting/sessions/revokeOthers": Auth,
	"POST /panel/setting/ui/get":                Auth, // own UI preferences
	"POST /panel/setting/ui/set":                Auth,
	"GET /panel/api/tokens/list":                Auth, // API tokens carry the permissions of their owner
	"POST /panel/api/tokens/create":             Auth,
	"POST /panel/api/tokens/revoke":             Auth,
	"GET /panel/rbac/me":                        Auth,
	"GET /panel/rbac/assignable-roles":          {"users:create|users:update"},

	// ----- dashboard, logs -----
	"GET /panel/api/server/status":                {DashboardRead},
	"GET /panel/api/server/cpuHistory/:bucket":    {DashboardRead},
	"GET /panel/api/server/memHistory/:bucket":    {DashboardRead},
	"GET /panel/api/server/diskHistory/:bucket":   {DashboardRead},
	"GET /panel/api/server/metrics":               {DashboardRead},
	"GET /panel/api/server/getXrayVersion":        {DashboardRead},
	"GET /panel/api/server/getTelemtVersion":      {DashboardRead},
	"POST /panel/api/server/logs/:count":          {LogsRead},
	"GET /panel/api/server/logs/unified/:count":   {LogsRead},
	"GET /panel/api/server/logs/entity/:type/:id": {LogsRead}, // the handler also needs nodes:read / balancers:read for those journals
	"GET /panel/api/server/logs/stream":           {LogsRead},
	"POST /panel/api/server/xraylogs/:count":      {LogsRead},

	// ----- inbounds -----
	"GET /panel/api/inbounds/list":                           {InboundsRead},
	"GET /panel/api/inbounds/get/:id":                        {InboundsRead},
	"GET /panel/api/inbounds/getClientTraffics/:email":       {ClientsRead},
	"GET /panel/api/inbounds/getClientTrafficsById/:id":      {ClientsRead},
	"GET /panel/api/inbounds/telemtDcStatus":                 {InboundsRead},
	"GET /panel/api/inbounds/telemtParams":                   {InboundsRead},
	"POST /panel/api/inbounds/add":                           {InboundsCreate},
	"POST /panel/api/inbounds/import":                        {InboundsCreate},
	"POST /panel/api/inbounds/update/:id":                    {InboundsUpdate},
	"POST /panel/api/inbounds/reorder":                       {InboundsUpdate},
	"POST /panel/api/inbounds/del/:id":                       {InboundsDelete},
	"POST /panel/api/inbounds/previewXray":                   {"inbounds:create|inbounds:update"},
	"POST /panel/api/inbounds/previewTelemt":                 {"inbounds:create|inbounds:update"},
	"POST /panel/api/inbounds/previewAmneziaWg":              {"inbounds:create|inbounds:update"},
	"POST /panel/api/inbounds/generateSelfSignedTls":         {"inbounds:create|inbounds:update"},
	"POST /panel/api/inbounds/computeTlsPin":                 {"inbounds:create|inbounds:update"},
	"POST /panel/api/inbounds/addClient":                     {ClientsCreate},
	"POST /panel/api/inbounds/updateClient/:clientId":        {ClientsUpdate},
	"POST /panel/api/inbounds/:id/delClient/:clientId":       {ClientsDelete},
	"POST /panel/api/inbounds/:id/delClientByEmail/:email":   {ClientsDelete},
	"POST /panel/api/inbounds/delDepletedClients/:id":        {ClientsDelete},
	"POST /panel/api/inbounds/:id/resetClientTraffic/:email": {ClientsOperate},
	"POST /panel/api/inbounds/resetAllClientTraffics/:id":    {ClientsOperate},
	"POST /panel/api/inbounds/resetAllTraffics":              {ClientsOperate},
	"POST /panel/api/inbounds/updateClientTraffic/:email":    {ClientsOperate},
	"POST /panel/api/inbounds/clientIps/:email":              {ClientsRead},
	"POST /panel/api/inbounds/clearClientIps/:email":         {ClientsOperate},
	"POST /panel/api/inbounds/onlines":                       {ClientsRead},
	"POST /panel/api/inbounds/lastOnline":                    {ClientsRead},

	// ----- clients -----
	"GET /panel/client/list":                 {ClientsRead},
	"GET /panel/client/get/:id":              {ClientsRead},
	"GET /panel/client/links/:id":            {ClientsRead},
	"GET /panel/client/sessions/:id":         {ClientsRead},
	"GET /panel/client/hwid/list/:clientId":  {ClientsRead},
	"POST /panel/client/add":                 {ClientsCreate},
	"POST /panel/client/update/:id":          {ClientsUpdate},
	"POST /panel/client/del/:id":             {ClientsDelete},
	"POST /panel/client/delDepletedClients":  {ClientsDelete},
	"POST /panel/client/resetAllTraffics":    {ClientsOperate},
	"POST /panel/client/resetTraffic/:id":    {ClientsOperate},
	"POST /panel/client/clearHwid/:id":       {ClientsOperate},
	"POST /panel/client/clearAllHwids":       {ClientsOperate},
	"POST /panel/client/setHwidLimitAll":     {ClientsUpdate},
	"POST /panel/client/bulk/resetTraffic":   {ClientsOperate},
	"POST /panel/client/bulk/clearHwid":      {ClientsOperate},
	"POST /panel/client/bulk/delete":         {ClientsDelete},
	"POST /panel/client/bulk/enable":         {ClientsUpdate},
	"POST /panel/client/bulk/setHwidLimit":   {ClientsUpdate},
	"POST /panel/client/sessions/drop/:id":   {ClientsOperate},
	"POST /panel/client/sessions/block/:id":  {ClientsOperate},
	"POST /panel/client/hwid/add":            {ClientsOperate},
	"POST /panel/client/hwid/del/:id":        {ClientsOperate},
	"POST /panel/client/hwid/deactivate/:id": {ClientsOperate},
	"POST /panel/client/hwid/block/:id":      {ClientsOperate},
	"POST /panel/client/hwid/check":          {ClientsOperate},
	"POST /panel/client/hwid/register":       {ClientsOperate},
	"POST /panel/client/hwid/fix-timestamps": {ClientsOperate},

	// ----- groups (bulk actions need the matching client permission too) -----
	"GET /panel/group/list":                      {GroupsRead},
	"GET /panel/group/get/:id":                   {GroupsRead},
	"GET /panel/group/:id/clients":               {GroupsRead, ClientsRead},
	"GET /panel/group/:id/effectiveSettings":     {GroupsRead},
	"POST /panel/group/add":                      {GroupsCreate},
	"POST /panel/group/update/:id":               {GroupsUpdate},
	"POST /panel/group/del/:id":                  {GroupsDelete},
	"POST /panel/group/:id/assignClients":        {GroupsUpdate},
	"POST /panel/group/:id/removeClients":        {GroupsUpdate},
	"POST /panel/group/:id/bulk/resetTraffic":    {GroupsRead, ClientsOperate},
	"POST /panel/group/:id/bulk/clearHwid":       {GroupsRead, ClientsOperate},
	"POST /panel/group/:id/bulk/delete":          {GroupsRead, ClientsDelete},
	"POST /panel/group/:id/bulk/enable":          {GroupsRead, ClientsUpdate},
	"POST /panel/group/:id/bulk/setHwidLimit":    {GroupsRead, ClientsUpdate},
	"POST /panel/group/:id/bulk/assignInbounds":  {GroupsRead, ClientsUpdate},
	"POST /panel/group/:id/bulk/assignBundles":   {GroupsRead, ClientsUpdate},
	"POST /panel/group/:id/bulk/setExpiry":       {GroupsRead, ClientsUpdate},
	"POST /panel/group/:id/bulk/setTrafficLimit": {GroupsRead, ClientsUpdate},
	"POST /panel/group/:id/bulk/setIPLimit":      {GroupsRead, ClientsUpdate},

	// ----- subscriptions: bundles and hosts -----
	"GET /panel/bundle/list":                     {BundlesRead},
	"GET /panel/bundle/get/:id":                  {BundlesRead},
	"GET /panel/bundle/members/:id":              {BundlesRead},
	"GET /panel/bundle/client/:id":               {BundlesRead},
	"GET /panel/bundle/state":                    {BundlesRead},
	"GET /panel/bundle/hosts":                    {"bundles:read|hosts:read"},
	"GET /panel/bundle/hosts/suppressed":         {"bundles:read|hosts:read"},
	"POST /panel/bundle/add":                     {BundlesCreate},
	"POST /panel/bundle/update/:id":              {BundlesUpdate},
	"POST /panel/bundle/del/:id":                 {BundlesDelete},
	"POST /panel/bundle/members/add":             {BundlesUpdate},
	"POST /panel/bundle/members/remove":          {BundlesUpdate},
	"POST /panel/bundle/client/:id/set":          {BundlesUpdate},
	"POST /panel/bundle/convert":                 {BundlesUpdate},
	"POST /panel/bundle/cleanup-unused-auto":     {BundlesUpdate},
	"POST /panel/bundle/hosts/add":               {HostsCreate},
	"POST /panel/bundle/hosts/update/:id":        {HostsUpdate},
	"POST /panel/bundle/hosts/reset/:id":         {HostsUpdate},
	"POST /panel/bundle/hosts/restore/:id":       {HostsUpdate},
	"POST /panel/bundle/hosts/del/:id":           {HostsDelete},
	"GET /panel/host/list":                       {HostsRead},
	"GET /panel/host/get/:id":                    {HostsRead},
	"POST /panel/host/add":                       {HostsCreate},
	"POST /panel/host/update/:id":                {HostsUpdate},
	"POST /panel/host/subscription-bindings/:id": {HostsUpdate},
	"POST /panel/host/del/:id":                   {HostsDelete},

	// ----- infrastructure: nodes, balancers -----
	"GET /panel/node/list":                         {NodesRead},
	"GET /panel/node/get/:id":                      {NodesRead},
	"GET /panel/node/status/:id":                   {NodesRead},
	"GET /panel/node/geography":                    {NodesRead},
	"GET /panel/node/client-traffic-per-node":      {NodesRead, ClientsRead},
	"GET /panel/node/secret":                       {NodesSecret},
	"GET /panel/node/ssh-provision-status/:taskId": {NodesCreate},
	"POST /panel/node/add":                         {NodesCreate},
	"POST /panel/node/ssh-hostkey":                 {NodesCreate},
	"POST /panel/node/ssh-provision":               {NodesCreate},
	"POST /panel/node/check-connection":            {"nodes:create|nodes:update"},
	"POST /panel/node/update/:id":                  {NodesUpdate},
	"POST /panel/node/reorder":                     {NodesUpdate},
	"POST /panel/node/del/:id":                     {NodesDelete},
	"POST /panel/node/check/:id":                   {NodesRead},
	"POST /panel/node/checkAll":                    {NodesRead},
	"POST /panel/node/logs/:id":                    {NodesRead, LogsRead},
	"POST /panel/node/reload/:id":                  {NodesOperate},
	"POST /panel/node/reloadAll":                   {NodesOperate},
	"POST /panel/node/resetTraffic/:id":            {NodesOperate},
	"POST /panel/node/stopXray/:id":                {NodesOperate},
	"POST /panel/node/restartXray/:id":             {NodesOperate},
	"POST /panel/node/stopTelemt/:id":              {NodesOperate},
	"POST /panel/node/restartTelemt/:id":           {NodesOperate},
	"POST /panel/node/stopAmneziaWg/:id":           {NodesOperate},
	"POST /panel/node/restartAmneziaWg/:id":        {NodesOperate},
	"GET /panel/balancer/list":                     {BalancersRead},
	"GET /panel/balancer/metrics/:id":              {BalancersRead},
	"POST /panel/balancer/add":                     {BalancersCreate},
	"POST /panel/balancer/ssh-install/:id":         {BalancersCreate},
	"POST /panel/balancer/update/:id":              {BalancersUpdate},
	"POST /panel/balancer/enable/:id":              {BalancersUpdate},
	"POST /panel/balancer/reorder":                 {BalancersUpdate},
	"POST /panel/balancer/pool/save":               {BalancersUpdate},
	"POST /panel/balancer/pool/del/:id":            {BalancersUpdate},
	"POST /panel/balancer/del/:id":                 {BalancersDelete},
	"POST /panel/balancer/apply/:id":               {BalancersOperate},
	"POST /panel/balancer/refresh/:id":             {BalancersOperate},
	"POST /panel/balancer/log-level/:id":           {BalancersOperate},

	// ----- xray: core settings, profiles, outbounds, services, geo files -----
	"POST /panel/xray/":                                         {XrayRead},
	"POST /panel/xray/getFullConfig":                            {XrayRead, InboundsUpdate, ClientsRead}, // same: the full config embeds the inbounds,
	"GET /panel/xray/getOutboundsTraffic":                       {XrayRead},
	"GET /panel/xray/getXrayResult":                             {XrayRead},
	"GET /panel/xray/getDefaultJsonConfig":                      {XrayRead},
	"GET /panel/setting/getDefaultJsonConfig":                   {XrayRead},
	"POST /panel/xray/update":                                   {XrayUpdate},
	"POST /panel/xray/resetToDefault":                           {XrayUpdate},
	"POST /panel/xray/warp/:action":                             {XrayUpdate},
	"POST /panel/xray/resetOutboundsTraffic":                    {XrayOperate},
	"GET /panel/xray-core-config-profile/list":                  {XrayRead},
	"GET /panel/xray-core-config-profile/get/:id":               {XrayRead},
	"POST /panel/xray-core-config-profile/add":                  {XrayUpdate},
	"POST /panel/xray-core-config-profile/update/:id":           {XrayUpdate},
	"POST /panel/xray-core-config-profile/del/:id":              {XrayUpdate},
	"POST /panel/xray-core-config-profile/set-default/:id":      {XrayUpdate},
	"POST /panel/xray-core-config-profile/reset-to-default/:id": {XrayUpdate},
	"POST /panel/xray-core-config-profile/assign-nodes/:id":     {XrayUpdate, NodesUpdate},
	"GET /panel/outbound/list":                                  {OutboundsRead},
	"GET /panel/outbound/get/:id":                               {OutboundsRead},
	"POST /panel/outbound/add":                                  {OutboundsCreate},
	"POST /panel/outbound/update/:id":                           {OutboundsUpdate},
	"POST /panel/outbound/del/:id":                              {OutboundsDelete},
	"GET /panel/api/server/getConfigJson":                       {XrayRead, InboundsUpdate, ClientsRead}, // the running config contains every client and the server keys,
	"POST /panel/api/server/stopXrayService":                    {XrayOperate},
	"POST /panel/api/server/restartXrayService":                 {XrayOperate},
	"POST /panel/api/server/stopTelemtService":                  {XrayOperate},
	"POST /panel/api/server/restartTelemtService":               {XrayOperate},
	"POST /panel/api/server/installXray/:version":               {XrayOperate},
	"POST /panel/api/server/installTelemt/:version":             {XrayOperate},
	"POST /panel/api/server/installXrayOnNodes/:version":        {XrayOperate, NodesOperate},
	"POST /panel/api/server/installTelemtOnNodes/:version":      {XrayOperate, NodesOperate},
	"GET /panel/api/server/geofileAssets/:fileName":             {XrayRead},
	"GET /panel/api/server/downloadGeofileTask/:taskID":         {XrayRead},
	"POST /panel/api/server/updateGeofile":                      {XrayOperate},
	"POST /panel/api/server/updateGeofile/:fileName":            {XrayOperate},
	"POST /panel/api/server/uploadGeofile/:fileName":            {XrayOperate},
	"POST /panel/api/server/rollbackGeofile/:fileName":          {XrayOperate},
	"POST /panel/api/server/downloadGeofileByUrl/:fileName":     {XrayOperate},
	"POST /panel/api/server/geofileAssets/upload/:fileName":     {XrayOperate},
	"POST /panel/api/server/geofileAssets/download/:fileName":   {XrayOperate},
	"POST /panel/api/server/geofileAssets/apply/:id":            {XrayOperate},
	"POST /panel/api/server/geofileAssets/delete/:id":           {XrayOperate},
	"GET /panel/api/server/getNewUUID":                          {"inbounds:create|inbounds:update|clients:create|clients:update"},
	"GET /panel/api/server/getNewVlessEnc":                      {"inbounds:create|inbounds:update"},
	"GET /panel/api/server/getNewX25519Cert":                    {"inbounds:create|inbounds:update"},
	"GET /panel/api/server/getNewmldsa65":                       {"inbounds:create|inbounds:update"},
	"GET /panel/api/server/getNewmlkem768":                      {"inbounds:create|inbounds:update"},
	"POST /panel/api/server/getNewEchCert":                      {"inbounds:create|inbounds:update"},

	// ----- settings -----
	"POST /panel/setting/update":                      {SettingsUpdate},
	"GET /panel/setting/grafana/dashboard":            {SettingsRead},
	"GET /panel/setting/secretPathsMeta":              {SettingsSecurity},
	"POST /panel/setting/generateSecretPaths":         {SettingsSecurity},
	"POST /panel/setting/saveSecretPaths":             {SettingsSecurity},
	"POST /panel/setting/twoFactor/begin":             Auth,
	"POST /panel/setting/twoFactor/complete":          Auth,
	"POST /panel/setting/twoFactor/disable":           Auth, // own 2FA, needs the current code
	"POST /panel/setting/twoFactor/cancel":            Auth,
	"POST /panel/setting/subscriptionPageConfig/list": {SettingsRead},
	"POST /panel/setting/subscriptionPageConfig/get":  {SettingsRead},
	"POST /panel/setting/subscriptionPageConfig/save": {SettingsUpdate},
	"POST /panel/setting/designerLibrary/get":         {SettingsRead},
	"POST /panel/setting/designerLibrary/save":        {SettingsUpdate},
	"POST /panel/setting/templates/list":              {SettingsRead},
	"POST /panel/setting/templates/preview":           {SettingsRead},
	"POST /panel/setting/templates/get":               {SettingsRead},
	"POST /panel/setting/templates/rate":              {SettingsRead},
	"POST /panel/setting/templates/report":            {SettingsRead},
	"POST /panel/setting/templates/profile/get":       {SettingsRead},
	"POST /panel/setting/templates/publish":           {SettingsUpdate},
	"POST /panel/setting/templates/delete":            {SettingsUpdate},
	"POST /panel/setting/templates/profile/set":       {SettingsUpdate},
	"POST /panel/setting/templates/local/list":        {SettingsRead},
	"POST /panel/setting/templates/local/get":         {SettingsRead},
	"POST /panel/setting/templates/local/save":        {SettingsUpdate},
	"POST /panel/setting/templates/local/saveContent": {SettingsUpdate},
	"POST /panel/setting/templates/local/update":      {SettingsUpdate},
	"POST /panel/setting/templates/local/delete":      {SettingsUpdate},
	"POST /panel/setting/templates/local/share":       {SettingsUpdate},

	// ----- system -----
	"POST /panel/setting/restartPanel":               {SystemUpdate},
	"GET /panel/api/server/updater":                  {SystemUpdate},
	"GET /panel/api/server/updater/plan":             {SystemUpdate},
	"GET /panel/api/server/updater/job":              {SystemUpdate},
	"POST /panel/api/server/updater/job/start":       {SystemUpdate},
	"POST /panel/api/server/updater/trigger":         {SystemUpdate},
	"POST /panel/api/server/updater/panel/trigger":   {SystemUpdate},
	"POST /panel/api/server/updater/workers/prep":    {SystemUpdate},
	"POST /panel/api/server/updater/workers/trigger": {SystemUpdate},
	"POST /panel/api/server/updater/workers/finish":  {SystemUpdate},
	"GET /panel/api/server/getDb":                    {SystemBackup},
	"POST /panel/api/server/importDB":                {SystemBackup},
	"GET /panel/api/backuptotgbot":                   {SystemBackup},
	"POST /panel/setting/migration/preview":          {SystemBackup},
	"POST /panel/setting/migration/execute":          {SystemBackup},
	"GET /panel/db/tables":                           {SystemDatabase},
	"GET /panel/db/tables/:table/schema":             {SystemDatabase},
	"GET /panel/db/tables/:table/rows":               {SystemDatabase},
	"POST /panel/db/tables/:table/rows":              {SystemDatabase},
	"POST /panel/db/tables/:table/rows/:pk":          {SystemDatabase},
	"POST /panel/db/tables/:table/rows/:pk/delete":   {SystemDatabase},

	// ----- access control -----
	"GET /panel/rbac/users":                       {UsersRead},
	"POST /panel/rbac/users":                      {UsersCreate},
	"POST /panel/rbac/users/:id/update":           {UsersUpdate},
	"POST /panel/rbac/users/:id/password":         {UsersUpdate},
	"POST /panel/rbac/users/:id/two-factor/reset": {UsersUpdate},
	"POST /panel/rbac/users/:id/delete":           {UsersDelete},
	"GET /panel/rbac/roles":                       {RolesRead},
	"GET /panel/rbac/permissions":                 {RolesRead},
	"POST /panel/rbac/roles":                      {RolesCreate},
	"POST /panel/rbac/roles/:id/update":           {RolesUpdate},
	"POST /panel/rbac/roles/:id/delete":           {RolesDelete},
	"GET /panel/rbac/audit":                       {AuditRead},
}

// Lookup returns the permissions required by a route. method and fullPath are as Gin reports them (fullPath already
// without the secret base path). HEAD is treated as GET. known is false for a route that has no entry.
func Lookup(method, fullPath string) (perms []string, known bool) {
	if method == "HEAD" {
		method = "GET"
	}
	perms, known = routes[method+" "+fullPath]
	return perms, known
}

// Routes returns the keys of the table (for tests that compare it with the router).
func Routes() []string {
	out := make([]string, 0, len(routes))
	for k := range routes {
		out = append(out, k)
	}
	sortStrings(out)
	return out
}

// RequirementsOf flattens a requirement list to the permission keys it mentions (alternatives expanded).
func RequirementsOf(perms []string) []string {
	var out []string
	for _, r := range perms {
		out = append(out, strings.Split(r, "|")...)
	}
	return out
}
