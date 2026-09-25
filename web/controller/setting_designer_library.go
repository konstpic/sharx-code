package controller

import (
	"github.com/konstpic/sharx-code/v2/web/service"

	"github.com/gin-gonic/gin"
)

type designerLibrarySaveForm struct {
	Library string `json:"library" form:"library"`
}

func (a *SettingController) designerLibraryGet(c *gin.Context) {
	var svc service.SettingService
	v, err := svc.GetDesignerLibrary()
	if err != nil {
		jsonMsg(c, "", err)
		return
	}
	jsonObj(c, gin.H{"library": v}, nil)
}

func (a *SettingController) designerLibrarySave(c *gin.Context) {
	var form designerLibrarySaveForm
	if err := c.ShouldBindJSON(&form); err != nil {
		if err2 := c.ShouldBind(&form); err2 != nil {
			jsonMsg(c, err.Error(), err2)
			return
		}
	}
	var svc service.SettingService
	jsonMsg(c, "", svc.SetDesignerLibrary(form.Library))
}
