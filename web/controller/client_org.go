package controller

import (
	"errors"

	"github.com/gin-gonic/gin"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/web/service"
)

// scopeOrgID is the organization the request's account is limited to, or nil when it is not limited.
func scopeOrgID(c *gin.Context) *int {
	if p := currentPrincipal(c); p != nil {
		return p.OrgId
	}
	return nil
}

// confineNewClientToOrg makes a client created by an organization's account stay inside the organization: it must be put in
// one of the organization's groups (the only group when none is named) and gets the inbounds and bundles of that group's
// clients, whatever the request asked for. See service.OrgClientTemplate.
func confineNewClientToOrg(org int, client *model.ClientEntity) (bundleIDs []int, err error) {
	groups := service.OrgGroupIDs(org)
	switch {
	case client.GroupId == nil && len(groups) == 1:
		g := groups[0]
		client.GroupId = &g
	case client.GroupId == nil:
		return nil, errors.New("choose one of the organization's groups for the client")
	case !service.GroupInOrg(org, *client.GroupId):
		return nil, errors.New("this group does not belong to your organization")
	}
	client.InboundIds, bundleIDs = service.OrgClientTemplate(org, *client.GroupId)
	return bundleIDs, nil
}

// confineClientUpdateToOrg keeps an edit by an organization's account inside the organization: the client may only move to
// another group of the organization, and its inbounds and bundles are not touched.
func confineClientUpdateToOrg(org int, client *model.ClientEntity) error {
	if client.GroupId == nil || !service.GroupInOrg(org, *client.GroupId) {
		return errors.New("the client must stay in one of your organization's groups")
	}
	client.InboundIds = nil
	return nil
}
