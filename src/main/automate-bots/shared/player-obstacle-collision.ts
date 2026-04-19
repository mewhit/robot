import { MotherlodeObstacleRedBox } from "./motherlode-obstacle-red-detector";
import { PlayerBox } from "./player-box-detector";

export function isPlayerCollidingWithObstacle(
  playerBoxInCapture: PlayerBox | null,
  obstacleBox: MotherlodeObstacleRedBox | null,
  paddingPx: number,
): boolean {
  if (!playerBoxInCapture || !obstacleBox) {
    return false;
  }

  const playerLeft = playerBoxInCapture.x;
  const playerTop = playerBoxInCapture.y;
  const playerRight = playerBoxInCapture.x + playerBoxInCapture.width - 1;
  const playerBottom = playerBoxInCapture.y + playerBoxInCapture.height - 1;

  const obstacleLeft = obstacleBox.x - paddingPx;
  const obstacleTop = obstacleBox.y - paddingPx;
  const obstacleRight = obstacleBox.x + obstacleBox.width - 1 + paddingPx;
  const obstacleBottom = obstacleBox.y + obstacleBox.height - 1 + paddingPx;

  return !(
    playerRight < obstacleLeft ||
    obstacleRight < playerLeft ||
    playerBottom < obstacleTop ||
    obstacleBottom < playerTop
  );
}
