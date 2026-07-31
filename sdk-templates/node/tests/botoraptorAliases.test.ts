import DefaultChatLayer, {
  Botoraptor,
  type BotoraptorConfig,
  ChatLayer,
} from '../chatLayerSDK';
import DefaultBotoraptor, {
  Botoraptor as BotoraptorFromWrapper,
  ChatLayer as ChatLayerFromWrapper,
} from '../botoraptor';

describe('Botoraptor aliases', () => {
  it('reuses the ChatLayer implementation for all exports', () => {
    expect(DefaultChatLayer).toBe(ChatLayer);
    expect(Botoraptor).toBe(ChatLayer);
    expect(DefaultBotoraptor).toBe(ChatLayer);
    expect(BotoraptorFromWrapper).toBe(ChatLayer);
    expect(ChatLayerFromWrapper).toBe(ChatLayer);
  });

  it('accepts the Botoraptor config alias', () => {
    const config: BotoraptorConfig = { apiKey: 'test-key' };
    const client = new Botoraptor(config);

    expect(client).toBeInstanceOf(ChatLayer);
  });
});
