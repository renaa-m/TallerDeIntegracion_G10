import traceback
from fastapi import APIRouter, HTTPException, status, Depends
from app.services.delete_user import purge_complete_user
from app.middleware.auth import get_current_user_id

router = APIRouter(prefix="/usuarios", tags=["usuarios"])

@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
async def delete_my_account(
    user_id: str = Depends(get_current_user_id)
):
    try:
        purge_complete_user(user_id)
        return None
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )